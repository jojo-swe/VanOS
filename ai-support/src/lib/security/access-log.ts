import { edgeDashboardEnabled, getAccessMode, trustProxy } from "@/lib/security/config";
import { normalizePath } from "@/lib/security/paths";

export type LogLevel = "info" | "warn" | "error";

export type RouteGroup = "ingest" | "mcp" | "v1" | "dashboard" | "edge";

export type AuthFailReason =
  | "bad_token"
  | "missing_token"
  | "basic_auth_fail"
  | "rate_limited";

export type MfaOkReason = "totp" | "recovery";

export type MfaFailReason =
  | "missing_code"
  | "bad_code"
  | "replay"
  | "rate_limited"
  | "recovery_used"
  | "cross_origin"
  | "unavailable";

const MAX_STACK_LINES = 20;
const MAX_MESSAGE = 500;

const SECRET_ENV = [
  "AGENT_API_TOKEN",
  "AGENT_API_TOKEN_PREVIOUS",
  "BOTS_INGEST_SECRET",
  "BOTS_INGEST_SECRET_PREVIOUS",
  "DASHBOARD_BASIC_PASSWORD",
  "VANOS_EDGE_SECRET",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "VANOS_TOTP_RECOVERY_CODES",
  "UPSTASH_REDIS_REST_TOKEN",
  "GITHUB_TOKEN",
  "NOTION_TOKEN",
  "OBSIDIAN_API_KEY",
] as const;

type HeaderSource = { get(name: string): string | null };

export type IpSource = {
  ip?: string | null;
  headers: HeaderSource;
};

export type RequestSource = IpSource & {
  url?: string;
  method?: string;
  nextUrl?: { pathname: string };
};

export function isoNow(): string {
  return new Date().toISOString();
}

/** Milliseconds since `started`, or the current timestamp when `started` is omitted. */
export function elapsedSince(started?: number): number {
  const now = Date.now();
  if (started === undefined) return now;
  return Math.max(0, now - started);
}

/** One JSON object, one line, stdout. No extra decoration. */
export function emitLog(record: Record<string, unknown>): void {
  const line = `${JSON.stringify(record)}\n`;
  if (typeof process !== "undefined" && typeof process.stdout?.write === "function") {
    process.stdout.write(line);
    return;
  }
  console.log(line.trimEnd());
}

export function sanitizeIp(value: string | null | undefined): string {
  if (!value) return "unknown";
  const ip = value.trim();
  if (!ip || ip.length > 64) return "unknown";
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return "unknown";
  return ip;
}

function forwardedHops(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True on Vercel, which sets VERCEL=1 for builds and functions. */
function onVercel(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * Vercel's edge overwrites X-Real-IP and X-Forwarded-For with the address
 * it saw, so a client cannot spoof them there. Next 16 no longer exposes
 * `req.ip`, so without this every caller shared one "unknown" address and
 * one rate-limit bucket.
 */
function vercelClientIp(req: IpSource): string {
  const real = sanitizeIp(req.headers.get("x-real-ip") ?? "");
  if (real !== "unknown") return real;
  const first = forwardedHops(
    req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for"),
  )[0];
  return sanitizeIp(first ?? "");
}

/**
 * Client IP for logs and rate limits.
 *
 * On Vercel (VERCEL=1) without VANOS_TRUST_PROXY: X-Real-IP, then the first
 * X-Vercel-Forwarded-For / X-Forwarded-For hop. Vercel sets these itself.
 *
 * VANOS_TRUST_PROXY off: the socket address only. X-Forwarded-For and
 * X-Real-IP are ignored.
 *
 * VANOS_TRUST_PROXY on: the immediate peer (socket) is the trusted proxy.
 * The header is treated as an append chain, client first and the proxy's
 * peer last. The client is the rightmost hop that is not that trusted peer.
 * A missing header falls back to the socket address.
 */
export function accessClientIp(req: IpSource): string {
  const socket = typeof req.ip === "string" ? sanitizeIp(req.ip) : "unknown";
  if (onVercel() && !trustProxy()) {
    const vercel = vercelClientIp(req);
    if (vercel !== "unknown") return vercel;
  }
  if (!trustProxy()) return socket;

  const hops = forwardedHops(req.headers.get("x-forwarded-for"));
  if (socket !== "unknown") hops.push(socket);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = sanitizeIp(hops[i]);
    if (hop === "unknown") continue;
    if (hop === socket) continue;
    return hop;
  }
  return socket;
}

/** Socket address when the runtime still exposes `ip`. Otherwise unknown. */
export function socketAddress(req: object): string {
  if ("ip" in req && typeof req.ip === "string") return sanitizeIp(req.ip);
  return "unknown";
}

export function safePath(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  let path = raw;
  if (!path) return "/";
  try {
    if (path.includes("://")) path = new URL(path).pathname;
  } catch {
    /* keep raw and strip below */
  }
  path = path.split("?")[0]?.split("#")[0] || "/";
  path = path.replace(/[\u0000-\u001f\u007f]/g, "");
  path = normalizePath(path);
  if (!path.startsWith("/")) path = `/${path}`;
  return path || "/";
}

export function requestPath(req: RequestSource): string {
  if (req.nextUrl?.pathname) return safePath(req.nextUrl.pathname);
  return safePath(req.url);
}

function safeMethod(method: string | null | undefined): string {
  const value = (method ?? "").toUpperCase();
  if (/^[A-Z]{1,10}$/.test(value)) return value;
  return "UNKNOWN";
}

export function routeGroupFor(
  pathname: string,
  opts?: { proxyStatus?: number },
): RouteGroup | null {
  const path = safePath(pathname);
  if (path === "/api/bots/ingest" || path.startsWith("/api/bots/ingest/")) return "ingest";
  if (path === "/api/mcp" || path.startsWith("/api/mcp/")) return "mcp";
  if (path === "/api/v1" || path.startsWith("/api/v1/")) return "v1";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "dashboard";
  if (opts?.proxyStatus !== undefined && getAccessMode() === "edge") return "edge";
  return null;
}

function statusLevel(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function dashboardWouldBeExposed(path: string, status: number): boolean {
  if (status !== 200) return false;
  if (safePath(path) !== "/dashboard") return false;
  if (getAccessMode() !== "edge") return false;
  return !edgeDashboardEnabled();
}

function emitRequest(fields: {
  method: string;
  path: string;
  status: number;
  ip: string;
  durMs: number;
  routeGroup: RouteGroup;
}): void {
  const path = safePath(fields.path);
  const exposed = dashboardWouldBeExposed(path, fields.status);
  emitLog({
    ts: isoNow(),
    level: exposed ? "error" : statusLevel(fields.status),
    method: safeMethod(fields.method),
    path,
    status: fields.status,
    ip: sanitizeIp(fields.ip),
    dur_ms: Math.max(0, Math.round(fields.durMs)),
    route_group: fields.routeGroup,
  });
  if (!exposed) return;
  emitLog({
    ts: isoNow(),
    level: "error",
    event: "dashboard_exposed",
    path: "/dashboard",
    mode: "edge",
  });
}

/** Log a response the proxy itself produced (not a continued request). */
export function logProxyResponse(req: RequestSource, status: number, durMs: number): void {
  const path = requestPath(req);
  const group = routeGroupFor(path, { proxyStatus: status });
  if (!group) return;
  emitRequest({
    method: req.method ?? "GET",
    path,
    status,
    ip: accessClientIp(req),
    durMs,
    routeGroup: group,
  });
}

/** Log the final status of a route handler or page. */
export function logHandledResponse(
  req: RequestSource,
  status: number,
  durMs: number,
): void {
  const path = requestPath(req);
  const group = routeGroupFor(path);
  if (!group) return;
  emitRequest({
    method: req.method ?? "GET",
    path,
    status,
    ip: accessClientIp(req),
    durMs,
    routeGroup: group,
  });
}

export function logPageView(fields: {
  method: string;
  path: string;
  status: number;
  durMs: number;
  socketIp: string | null;
  forwardedFor: string | null;
}): void {
  const group = routeGroupFor(fields.path);
  if (!group) return;
  emitRequest({
    method: fields.method,
    path: fields.path,
    status: fields.status,
    ip: accessClientIp({
      ip: fields.socketIp,
      headers: {
        get(name: string) {
          return name.toLowerCase() === "x-forwarded-for" ? fields.forwardedFor : null;
        },
      },
    }),
    durMs: fields.durMs,
    routeGroup: group,
  });
}

export function withRequestLog<A extends unknown[]>(
  handler: (req: Request, ...args: A) => Promise<Response> | Response,
): (req: Request, ...args: A) => Promise<Response> {
  return async (req: Request, ...args: A) => {
    const started = Date.now();
    try {
      const res = await handler(req, ...args);
      logHandledResponse(req, res.status, Date.now() - started);
      return res;
    } catch (err) {
      const flow = frameworkStatus(err);
      logHandledResponse(req, flow ?? 500, Date.now() - started);
      throw err;
    }
  };
}

export function authFailReason(req: { headers: HeaderSource }): AuthFailReason {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+\S+/i.test(auth)) return "bad_token";
  if (req.headers.get("x-vanos-ingest-secret")?.trim()) return "bad_token";
  if (req.headers.get("x-vanos-agent-token")?.trim()) return "bad_token";
  return "missing_token";
}

export function logAuthOk(req: RequestSource): void {
  emitLog({
    ts: isoNow(),
    level: "info",
    event: "auth_ok",
    path: requestPath(req),
    ip: accessClientIp(req),
  });
}

export function logAuthFail(req: RequestSource, reason: AuthFailReason): void {
  emitLog({
    ts: isoNow(),
    level: "warn",
    event: "auth_fail",
    reason,
    path: requestPath(req),
    ip: accessClientIp(req),
  });
}

/** Second factor succeeded. `reason` is `totp` or `recovery`. The code is not logged. */
export function logMfaOk(req: RequestSource, reason: MfaOkReason): void {
  emitLog({
    ts: isoNow(),
    level: "info",
    event: "mfa_ok",
    reason,
    path: requestPath(req),
    ip: accessClientIp(req),
  });
}

/** Second factor rejected. The code, cookie, and secret are not logged. */
export function logMfaFail(req: RequestSource, reason: MfaFailReason): void {
  emitLog({
    ts: isoNow(),
    level: "warn",
    event: "mfa_fail",
    reason,
    path: requestPath(req),
    ip: accessClientIp(req),
  });
}

/**
 * An authenticated logout. `revoked: true` means every session cookie was
 * invalidated. `revoked: false` (warn, reason `unavailable`) means storage
 * could not be written: only this browser's cookie was cleared.
 */
export function logLogout(req: RequestSource, revoked: boolean): void {
  emitLog({
    ts: isoNow(),
    level: revoked ? "info" : "warn",
    event: "logout",
    revoked,
    ...(revoked ? {} : { reason: "unavailable" }),
    path: requestPath(req),
    ip: accessClientIp(req),
  });
}

/** missing_token is logged at the 401. bad_token is logged where the credential is checked. */
export function logMissingToken(req: RequestSource): void {
  if (authFailReason(req) === "missing_token") logAuthFail(req, "missing_token");
}

export function noteBearerResult(req: RequestSource, ok: boolean): void {
  if (ok) {
    logAuthOk(req);
    return;
  }
  if (authFailReason(req) === "bad_token") logAuthFail(req, "bad_token");
}

function secretValues(): string[] {
  const values: string[] = [];
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 8) values.push(value);
  }
  return values;
}

/** Drop query strings, bearer tokens, cookies, and known secret env values. */
export function redact(text: string): string {
  let out = text;
  out = out.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "[redacted-url]";
    }
  });
  out = out.replace(/\?[^\s"'<>]*/g, "");
  out = out.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(
    /(authorization|cookie|set-cookie|x-vanos-ingest-secret|x-vanos-agent-token|x-vanos-totp)\s*[:=]\s*\S+/gi,
    "$1=[redacted]",
  );
  for (const secret of secretValues()) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function frameworkStatus(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("digest" in err)) return null;
  const digest = String((err as { digest?: unknown }).digest ?? "");
  if (digest.startsWith("NEXT_REDIRECT")) return 307;
  if (digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
    const match = /;(\d{3})$/.exec(digest);
    return match ? Number(match[1]) : 404;
  }
  return null;
}

export function logServerError(route: string, err: unknown): void {
  if (frameworkStatus(err) !== null) return;
  const error = err instanceof Error ? err : new Error("Unknown error");
  const lines = (error.stack ?? "").split(/\r?\n/).slice(0, MAX_STACK_LINES);
  emitLog({
    ts: isoNow(),
    level: "error",
    event: "error",
    route: safePath(route),
    error: error.name || "Error",
    message: redact(error.message).slice(0, MAX_MESSAGE),
    stack: redact(lines.join("\n")),
  });
}
