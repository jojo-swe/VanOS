import { createHash, createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { configuredAgentTokens, matchesToken, MIN_TOKEN_LENGTH } from "@/lib/security/tokens";
import {
  getSessionSecret,
  getTotpAccount,
  getTotpAttemptLimit,
  getTotpAttemptWindowMs,
  getTotpIssuer,
  getTotpSecret,
  totpEnabled,
} from "@/lib/security/config";
import { appOrigins } from "@/lib/security/csrf";
import {
  logMfaFail,
  logMfaOk,
  type MfaFailReason,
  type MfaOkReason,
  type RequestSource,
} from "@/lib/security/access-log";
import { durableUpdateJson, isDurableWriteError } from "@/lib/durable/store";
import { clientIp, rateLimitConsumeDurable } from "@/lib/security/rate-limit";
import { timingSafeEqualString } from "@/lib/security/timing";
import {
  applySessionCookie,
  clearSessionCookie,
  issueSessionToken,
  readCookie,
  SESSION_COOKIE_NAME,
  sessionIsCurrent,
  sessionIsValid,
  signSessionToken,
  verifySessionToken,
} from "@/lib/security/session";

export {
  applySessionCookie,
  clearSessionCookie,
  issueSessionToken,
  readCookie,
  SESSION_COOKIE_NAME,
  sessionIsCurrent,
  sessionIsValid,
  signSessionToken,
  verifySessionToken,
};

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;
const MIN_SECRET_BYTES = 16;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type HeaderBag = { get(name: string): string | null };

export type TotpRequest = RequestSource & {
  headers: HeaderBag;
  method?: string;
};

export type TotpDecision =
  | { kind: "skip" }
  | { kind: "continue" }
  | { kind: "session"; token: string }
  | { kind: "challenge" }
  | {
      kind: "reject";
      status: 401 | 403 | 429 | 503;
      reason: MfaFailReason;
      retryAfter?: number;
    };

type CodeResult =
  | { ok: true; reason: MfaOkReason }
  | { ok: false; reason: Extract<MfaFailReason, "bad_code" | "replay" | "recovery_used" | "unavailable"> };

/**
 * Accepted TOTP steps and codes. The durable copy (REPLAY_KEY) survives a
 * restart and is shared through Upstash; these maps are this process's own
 * record. Both are consulted, and a code either one has seen is a replay.
 */
const usedSteps = new Map<number, number>();
const usedCodes = new Map<string, number>();
const REPLAY_KEY = "totp-replay";
let usedRecovery = new Set<string>();
let usedRecoveryLoaded = false;

export function clearTotpState(): void {
  usedSteps.clear();
  usedCodes.clear();
  usedRecovery = new Set();
  usedRecoveryLoaded = false;
}

export function decodeBase32(input: string): Uint8Array | null {
  const cleaned = input
    .trim()
    .replace(/\s+/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();
  if (!cleaned || !/^[A-Z2-7]+$/.test(cleaned)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of cleaned) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (bytes.length < MIN_SECRET_BYTES) return null;
  return Uint8Array.from(bytes);
}

export function encodeBase32(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(value >> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

/** RFC 4226 dynamic truncation. `digits` is 6 for the dashboard and 8 for the RFC 6238 vectors. */
export function hotp(secret: Uint8Array, counter: number, digits: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return (bin % mod).toString().padStart(digits, "0");
}

export function totpCounter(timeMs: number, periodSec = TOTP_PERIOD_SEC): number {
  return Math.floor(timeMs / 1000 / periodSec);
}

export function totpAt(
  secret: Uint8Array,
  timeMs: number,
  digits = TOTP_DIGITS,
  periodSec = TOTP_PERIOD_SEC,
): string {
  return hotp(secret, totpCounter(timeMs, periodSec), digits);
}

export function mfaConfigProblems(): string[] {
  const secret = getTotpSecret();
  if (!secret) return [];
  const problems: string[] = [];
  if (!decodeBase32(secret)) {
    const compact = secret.replace(/=+$/g, "");
    if (/^[A-Z2-7]+$/.test(compact)) {
      problems.push(`VANOS_TOTP_SECRET is shorter than ${MIN_SECRET_BYTES} bytes`);
    } else {
      problems.push("VANOS_TOTP_SECRET is not valid base32");
    }
  }
  const session = getSessionSecret();
  if (!session || session.length < MIN_TOKEN_LENGTH) {
    problems.push(`VANOS_SESSION_SECRET is shorter than ${MIN_TOKEN_LENGTH} characters`);
  }
  return problems;
}

function sessionSecretOk(): boolean {
  const secret = getSessionSecret();
  return Boolean(secret && secret.length >= MIN_TOKEN_LENGTH);
}

/**
 * Same-origin path for the MFA form and the success `Location`.
 * The header stays relative. An absolute URL built from `req.url` follows
 * the bind address behind a reverse proxy (`https://0.0.0.0:3000/...`).
 * Open redirects are rejected: one leading `/`, never `//`, and no scheme.
 * Anything else is `/dashboard`.
 */
export function safeNextPath(input: string | null | undefined): string {
  if (!input) return "/dashboard";
  const pathOnly = input.split("?")[0]?.split("#")[0] ?? "";
  if (
    !pathOnly.startsWith("/") ||
    pathOnly.startsWith("//") ||
    pathOnly.includes("\\") ||
    pathOnly.includes(":") ||
    pathOnly.length > 256 ||
    pathOnly === "/api/auth/mfa" ||
    pathOnly === "/api/auth/logout"
  ) {
    return "/dashboard";
  }
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(pathOnly)) return "/dashboard";
  return pathOnly;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function mfaChallengeHtml(nextPath: string, message?: string): string {
  const next = escapeHtml(safeNextPath(nextPath));
  const notice = message
    ? `<p class="err">${escapeHtml(message)}</p>`
    : "<p>Enter the 6-digit code from your authenticator, or a recovery code.</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VanOS — verification code</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10140f; color: #e7efe2; font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; }
  form { width: min(22rem, calc(100% - 2rem)); display: grid; gap: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  p { margin: 0; color: #c5d4c0; }
  .err { color: #f0c4b4; }
  input { font: inherit; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid #3c4a38; background: #181e16; color: inherit; }
  button { font: inherit; padding: 0.65rem 0.75rem; border: 0; border-radius: 0.5rem; background: #d7f26a; color: #15200c; font-weight: 650; }
</style>
</head>
<body>
<form method="post" action="/api/auth/mfa">
  <h1>Verification code</h1>
  ${notice}
  <input type="hidden" name="next" value="${next}">
  <label>Code <input name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="64" required autofocus></label>
  <button type="submit">Continue</button>
</form>
</body>
</html>`;
}

function requestHasAgentToken(req: TotpRequest): boolean {
  const expected = configuredAgentTokens();
  if (!expected.length) return false;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && matchesToken(token, expected)) return true;
  }
  const header = req.headers.get("x-vanos-agent-token")?.trim();
  return Boolean(header && matchesToken(header, expected));
}

function isMfaPost(req: TotpRequest): boolean {
  const path = req.nextUrl?.pathname ?? "";
  let pathname = path;
  if (!pathname && req.url) {
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      pathname = "";
    }
  }
  return pathname.replace(/\/+$/, "") === "/api/auth/mfa" && (req.method ?? "GET").toUpperCase() === "POST";
}

function pruneReplay(nowMs: number): void {
  for (const [step, exp] of usedSteps) {
    if (exp <= nowMs) usedSteps.delete(step);
  }
  for (const [code, exp] of usedCodes) {
    if (exp <= nowMs) usedCodes.delete(code);
  }
}

/** When a step stops being accepted, so its replay record can go. */
function stepExpiresAt(step: number): number {
  return (step + 1 + TOTP_WINDOW_STEPS) * TOTP_PERIOD_SEC * 1000;
}

/**
 * Replay records name the code by an HMAC under the TOTP secret, so neither
 * the store nor Upstash holds a used code in the clear.
 */
function codeId(secret: Uint8Array, code: string): string {
  return createHmac("sha256", secret).update(`vanos.totp.used.v1:${code}`).digest("base64url").slice(0, 22);
}

type ReplayDoc = { steps: Record<string, number>; codes: Record<string, number> };

function liveEntries(value: unknown, nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, exp] of Object.entries(value as Record<string, unknown>)) {
    if (typeof exp === "number" && Number.isFinite(exp) && exp > nowMs) out[key] = exp;
  }
  return out;
}

/**
 * Claim the first candidate step nobody has used, plus the code, in the
 * durable store. Returns the claimed step, null when the store says the code
 * or every candidate step was already used, or undefined when the store could
 * not be written (demo mode, Upstash down, data directory not writable).
 * Expired records are dropped on every write, so the document only ever holds
 * the last ±1 step window.
 */
async function claimDurable(
  candidates: number[],
  id: string,
  nowMs: number,
): Promise<number | null | undefined> {
  // Set from inside `update`, which may run more than once; the last run is
  // the one that was stored.
  const out: { step: number | null | undefined } = { step: undefined };
  try {
    await durableUpdateJson<ReplayDoc>(REPLAY_KEY, (current) => {
      const doc: ReplayDoc = {
        steps: liveEntries(current?.steps, nowMs),
        codes: liveEntries(current?.codes, nowMs),
      };
      const step = doc.codes[id] ? undefined : candidates.find((s) => !doc.steps[String(s)]);
      if (step === undefined) {
        out.step = null;
        return null;
      }
      const exp = stepExpiresAt(step);
      doc.steps[String(step)] = exp;
      doc.codes[id] = exp;
      out.step = step;
      return doc;
    });
  } catch (e) {
    if (!isDurableWriteError(e)) throw e;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "durable_write_failed",
        label: "totp-replay",
        detail: e.message,
      }),
    );
    return undefined;
  }
  return out.step;
}

/**
 * A code is accepted once. This process's maps are checked and updated
 * first, before any await, so two submissions racing here cannot both pass
 * and anything this process has seen stays rejected. Then the durable store
 * gets the final say: if it has the code or every matching step, it is a
 * replay even if this process just restarted. If the store cannot be
 * written, the process maps alone decide, so an outage does not lock the
 * owner out; the code is still single-use within this process.
 */
async function acceptTotp(secret: Uint8Array, code: string, nowMs: number): Promise<CodeResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "bad_code" };
  pruneReplay(nowMs);
  const counter = totpCounter(nowMs);
  const matches: number[] = [];
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const step = counter + offset;
    if (step < 0) continue;
    if (hotp(secret, step, TOTP_DIGITS) === code) matches.push(step);
  }
  if (matches.length === 0) return { ok: false, reason: "bad_code" };
  const id = codeId(secret, code);
  const candidates = matches.filter((step) => !usedSteps.has(step));
  const first = candidates[0];
  if (first === undefined || usedCodes.has(id)) return { ok: false, reason: "replay" };
  usedSteps.set(first, stepExpiresAt(first));
  usedCodes.set(id, stepExpiresAt(first));

  const claimed = await claimDurable(candidates, id, nowMs);
  if (claimed === null) return { ok: false, reason: "replay" };
  if (claimed !== undefined && claimed !== first) {
    usedSteps.set(claimed, stepExpiresAt(claimed));
    usedCodes.set(id, Math.max(usedCodes.get(id) ?? 0, stepExpiresAt(claimed)));
  }
  return { ok: true, reason: "totp" };
}

function recoveryHashesFromEnv(): string[] {
  const raw = process.env.VANOS_TOTP_RECOVERY_CODES ?? "";
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[0-9a-f]{64}$/.test(part));
}

function recoveryHashesFromFile(): string[] {
  const file = process.env.VANOS_TOTP_RECOVERY_FILE?.trim();
  if (!file || !existsSync(/* turbopackIgnore: true */ file)) return [];
  let text = "";
  try {
    text = readFileSync(/* turbopackIgnore: true */ file, "utf8").slice(0, 65_536);
  } catch {
    return [];
  }
  const hashes: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const hash = trimmed.toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hash)) hashes.push(hash);
  }
  return hashes;
}

function configuredRecoveryHashes(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hash of [...recoveryHashesFromEnv(), ...recoveryHashesFromFile()]) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(hash);
  }
  return out;
}

export function recoveryUsedPath(): string | undefined {
  const explicit = process.env.VANOS_TOTP_RECOVERY_USED_FILE?.trim();
  if (explicit) return explicit;
  const file = process.env.VANOS_TOTP_RECOVERY_FILE?.trim();
  if (file) return `${file}.used`;
  if (recoveryHashesFromEnv().length > 0) {
    return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "totp-recovery-used.txt");
  }
  return undefined;
}

function loadUsedRecovery(): Set<string> {
  if (usedRecoveryLoaded) return usedRecovery;
  usedRecoveryLoaded = true;
  const file = recoveryUsedPath();
  if (!file || !existsSync(/* turbopackIgnore: true */ file)) return usedRecovery;
  try {
    const text = readFileSync(/* turbopackIgnore: true */ file, "utf8").slice(0, 65_536);
    for (const line of text.split(/\r?\n/)) {
      const hash = line.trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hash)) usedRecovery.add(hash);
    }
  } catch {
    /* treat an unreadable used-file as empty and fail closed on the next write */
  }
  return usedRecovery;
}

function persistUsedRecovery(hash: string): boolean {
  const file = recoveryUsedPath();
  if (!file) return false;
  try {
    mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    appendFileSync(/* turbopackIgnore: true */ file, `${hash}\n`, { mode: 0o600 });
  } catch {
    return false;
  }
  usedRecovery.add(hash);
  usedRecoveryLoaded = true;
  return true;
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

function acceptRecovery(code: string): CodeResult {
  const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z2-9]{8,64}$/.test(normalized)) return { ok: false, reason: "bad_code" };
  const hash = createHash("sha256").update(normalized).digest("hex");
  const configured = configuredRecoveryHashes();
  const dummy = "0".repeat(64);
  let matched = 0;
  const candidates = configured.length > 0 ? configured : [dummy];
  for (const candidate of candidates) {
    if (timingSafeEqualString(hash, candidate)) matched = 1;
  }
  if (!matched || configured.length === 0) return { ok: false, reason: "bad_code" };
  if (loadUsedRecovery().has(hash)) return { ok: false, reason: "recovery_used" };
  if (!persistUsedRecovery(hash)) return { ok: false, reason: "unavailable" };
  return { ok: true, reason: "recovery" };
}

export async function checkMfaCode(code: string, nowMs = Date.now()): Promise<CodeResult> {
  const secret = getTotpSecret();
  const decoded = secret ? decodeBase32(secret) : null;
  if (!decoded) return { ok: false, reason: "unavailable" };
  const compact = code.trim().replace(/[\s-]+/g, "");
  if (/^\d{6}$/.test(compact)) return await acceptTotp(decoded, compact, nowMs);
  return acceptRecovery(code);
}

export type TotpSubmission =
  | { ok: true; token: string; reason: MfaOkReason }
  | { ok: false; status: 401 | 429 | 503; reason: MfaFailReason; retryAfter?: number };

/**
 * Rate-limit, verify, burn the code, and sign a session. Logs mfa_ok or mfa_fail.
 * The attempt limit is durable (Upstash or the local attempts file), so a
 * restart does not reset it.
 */
export async function submitTotp(
  req: TotpRequest,
  code: string,
  nowMs = Date.now(),
): Promise<TotpSubmission> {
  if (!totpEnabled() || !sessionSecretOk() || !decodeBase32(getTotpSecret() ?? "")) {
    logMfaFail(req, "unavailable");
    return { ok: false, status: 503, reason: "unavailable" };
  }
  const limit = await rateLimitConsumeDurable(
    `totp:${clientIp(req)}`,
    getTotpAttemptLimit(),
    getTotpAttemptWindowMs(),
  );
  if (!limit.ok) {
    logMfaFail(req, "rate_limited");
    return {
      ok: false,
      status: 429,
      reason: "rate_limited",
      retryAfter: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
    };
  }
  const presented = code.trim();
  if (!presented) {
    logMfaFail(req, "missing_code");
    return { ok: false, status: 401, reason: "missing_code" };
  }
  const verdict = await checkMfaCode(presented, nowMs);
  if (!verdict.ok) {
    logMfaFail(req, verdict.reason);
    return { ok: false, status: verdict.reason === "unavailable" ? 503 : 401, reason: verdict.reason };
  }
  // Null when storage cannot say which session generation is current. The
  // code is spent either way; the owner retries once storage answers.
  const token = await issueSessionToken(nowMs);
  if (!token) {
    logMfaFail(req, "unavailable");
    return { ok: false, status: 503, reason: "unavailable" };
  }
  logMfaOk(req, verdict.reason);
  return { ok: true, token, reason: verdict.reason };
}

/**
 * After basic auth has already succeeded, unless the proxy already
 * accepted a valid session cookie and skipped this step.
 * Skip when TOTP is unset, the session cookie is valid, or the request
 * carries an agent token. POST /api/auth/mfa is forwarded to the route.
 * X-VanOS-TOTP is verified here. Anything else is the HTML challenge.
 * The agent token skips TOTP only. It does not skip Basic auth.
 */
export async function evaluateTotp(req: TotpRequest, nowMs = Date.now()): Promise<TotpDecision> {
  if (!totpEnabled()) return { kind: "skip" };
  if (!sessionSecretOk() || !decodeBase32(getTotpSecret() ?? "")) {
    logMfaFail(req, "unavailable");
    return { kind: "reject", status: 503, reason: "unavailable" };
  }
  const cookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (await sessionIsCurrent(cookie, nowMs)) return { kind: "skip" };
  if (requestHasAgentToken(req)) return { kind: "skip" };
  if (isMfaPost(req)) return { kind: "continue" };
  const header = req.headers.get("x-vanos-totp")?.trim();
  if (header) {
    const submitted = await submitTotp(req, header, nowMs);
    if (!submitted.ok) {
      return {
        kind: "reject",
        status: submitted.status,
        reason: submitted.reason,
        retryAfter: submitted.retryAfter,
      };
    }
    return { kind: "session", token: submitted.token };
  }
  return { kind: "challenge" };
}

export function mfaSubmissionAllowed(req: Request): boolean {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json" && type !== "application/x-www-form-urlencoded") return false;
  const origin = req.headers.get("origin")?.trim();
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  // Referrer-Policy: no-referrer serializes a same-origin form POST as
  // Origin: null. Trust that value only when the browser also says the
  // request is same-origin. A missing Sec-Fetch-Site, or any other value,
  // stays a cross-origin rejection.
  if (origin === "null") {
    if (site !== "same-origin") return false;
  } else if (origin) {
    try {
      if (!appOrigins(req).has(new URL(origin).origin)) return false;
    } catch {
      return false;
    }
  }
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  let raw = "";
  for (let i = 0; i < 12; i += 1) raw += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function otpauthUri(secret: string, issuer = getTotpIssuer(), account = getTotpAccount()): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function buildTotpSetup(opts?: {
  issuer?: string;
  account?: string;
  recoveryCount?: number;
}): {
  secret: string;
  uri: string;
  recoveryCodes: string[];
  recoveryHashes: string[];
} {
  const secret = encodeBase32(randomBytes(20));
  const issuer = opts?.issuer ?? getTotpIssuer();
  const account = opts?.account ?? getTotpAccount();
  const count = opts?.recoveryCount ?? 8;
  const recoveryCodes = Array.from({ length: count }, () => generateRecoveryCode());
  return {
    secret,
    uri: otpauthUri(secret, issuer, account),
    recoveryCodes,
    recoveryHashes: recoveryCodes.map((code) => hashRecoveryCode(code)),
  };
}

