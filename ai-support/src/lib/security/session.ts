import { createHmac } from "node:crypto";
import {
  getBasicAuth,
  getSessionSecret,
  getSessionTtlSeconds,
  getTotpSecret,
} from "@/lib/security/config";
import {
  currentSessionGeneration,
  ensureSessionGeneration,
  isValidGeneration,
  lastKnownSessionGeneration,
  type GenerationLookup,
} from "@/lib/security/session-generation";
import { timingSafeEqualString } from "@/lib/security/timing";
import { MIN_TOKEN_LENGTH } from "@/lib/security/tokens";

export const SESSION_COOKIE_NAME = "vanos_session";

/**
 * v3 adds `gen`, the session generation (see session-generation.ts).
 * Cookies from v2 carry none and are rejected, so they cannot outlive a
 * logout; the browser asks for Basic auth (and TOTP) once after the upgrade.
 */
const TOKEN_VERSION = "v3";
/** Matches the longest VANOS_SESSION_TTL_DAYS the config will issue. */
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;

type CookieJar = {
  cookies: {
    set: (
      name: string,
      value: string,
      options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: "lax";
        path: string;
        maxAge: number;
      },
    ) => void;
  };
};

function signingSecret(): string | null {
  const secret = getSessionSecret();
  if (!secret || secret.length < MIN_TOKEN_LENGTH) return null;
  return secret;
}

function hmacSha256(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Fingerprint of the credentials this cookie was issued under.
 * The password and TOTP secret stay on the server. Changing either,
 * or clearing TOTP, makes an existing cookie fail this check.
 */
export function sessionConfigTag(secret: string): string {
  const creds = getBasicAuth();
  const user = creds?.user ?? "";
  const pass = creds?.pass ?? "";
  const totp = getTotpSecret() ?? "";
  return hmacSha256(
    secret,
    `vanos.session.cfg.v1\nuser:${user}\npass:${pass}\ntotp:${totp}`,
  );
}

/** Sign a cookie for generation `gen`. Null when no usable signing secret is set. */
export function signSessionToken(gen: string, nowMs = Date.now()): string | null {
  const secret = signingSecret();
  if (!secret || !isValidGeneration(gen)) return null;
  const ttl = getSessionTtlSeconds();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttl;
  const cfg = sessionConfigTag(secret);
  const payload = Buffer.from(JSON.stringify({ v: 3, iat, exp, cfg, gen })).toString(
    "base64url",
  );
  const sig = hmacSha256(secret, `${TOKEN_VERSION}.${payload}`);
  return `${TOKEN_VERSION}.${payload}.${sig}`;
}

/**
 * Sign a cookie for the current session generation, writing the first
 * generation if storage holds none. Null when there is no signing secret or
 * storage cannot say which generation is current: no cookie is issued then,
 * and the dashboard keeps asking for Basic auth.
 */
export async function issueSessionToken(nowMs = Date.now()): Promise<string | null> {
  if (!signingSecret()) return null;
  const gen = await ensureSessionGeneration();
  if (!gen) return null;
  return signSessionToken(gen, nowMs);
}

/**
 * Check signature, version, lifetime and the credential binding, and return
 * the generation the cookie was signed with. Does not check whether that
 * generation is still current.
 */
export function verifySessionToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): { gen: string } | null {
  const secret = signingSecret();
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const version = parts[0] ?? "";
  const payload = parts[1] ?? "";
  const sig = parts[2] ?? "";
  const expected = hmacSha256(secret, `${version}.${payload}`);
  if (!timingSafeEqualString(sig, expected) || version !== TOKEN_VERSION) return null;

  let body: { exp?: unknown; iat?: unknown; cfg?: unknown; gen?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
      iat?: unknown;
      cfg?: unknown;
      gen?: unknown;
    };
  } catch {
    return null;
  }
  if (
    typeof body.exp !== "number" ||
    typeof body.iat !== "number" ||
    !Number.isFinite(body.exp) ||
    !Number.isFinite(body.iat)
  ) {
    return null;
  }
  const now = Math.floor(nowMs / 1000);
  if (body.exp <= now || body.iat > now + 60) return null;
  if (body.exp - body.iat > MAX_TTL_SECONDS || body.exp - body.iat < 60) return null;
  if (!isValidGeneration(body.gen)) return null;
  const presented = typeof body.cfg === "string" ? body.cfg : "";
  if (!timingSafeEqualString(presented, sessionConfigTag(secret))) return null;
  return { gen: body.gen };
}

function generationMatches(presented: string, lookup: GenerationLookup): boolean {
  // Unknown generation, or none stored yet: no cookie is accepted.
  if (!lookup.known || !lookup.gen) return false;
  return timingSafeEqualString(presented, lookup.gen);
}

/**
 * Synchronous check for route handlers and pages: a verified cookie whose
 * generation matches the one this process last read. The proxy has already
 * refreshed that value for the same request, so a logged-out cookie fails
 * here too. If this process has no recent value, the cookie is rejected.
 */
export function sessionIsValid(
  token: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const verified = verifySessionToken(token, nowMs);
  if (!verified) return false;
  return generationMatches(verified.gen, lastKnownSessionGeneration());
}

/**
 * The proxy's check: a verified cookie whose generation is the current one,
 * read from storage at most SESSION_GENERATION_FRESH_MS ago. Storage is only
 * consulted for a cookie that already passed the signature check.
 */
export async function sessionIsCurrent(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  const verified = verifySessionToken(token, nowMs);
  if (!verified) return false;
  return generationMatches(verified.gen, await currentSessionGeneration());
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    return part.slice(i + 1).trim();
  }
  return null;
}

export function requestHasValidSession(
  headers: { get(name: string): string | null },
  nowMs = Date.now(),
): boolean {
  return sessionIsValid(readCookie(headers.get("cookie"), SESSION_COOKIE_NAME), nowMs);
}

/** Async variant for the proxy and logout: checks the generation in storage. */
export async function requestHasCurrentSession(
  headers: { get(name: string): string | null },
  nowMs = Date.now(),
): Promise<boolean> {
  return sessionIsCurrent(readCookie(headers.get("cookie"), SESSION_COOKIE_NAME), nowMs);
}

function cookieOptions(maxAge: number): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export function applySessionCookie(res: CookieJar, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, cookieOptions(getSessionTtlSeconds()));
}

export function clearSessionCookie(res: CookieJar): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", cookieOptions(0));
}
