export type AccessMode = "public" | "hybrid" | "private" | "edge";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = env(name)?.toLowerCase();
  if (v == null) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Access modes:
 * - public  — open UI (basic auth if set); bearer for agent writes. Dev / temporary.
 * - hybrid  — UI requires basic auth (fail closed); wider public bearer surface.
 *             Kept for existing hosts. New Vercel deploys should use `edge`.
 * - edge    — public deployment exposes only /api/bots/ingest, /api/mcp, and
 *             /api/v1/health. Dashboard and every other route are 404,
 *             unless VANOS_EDGE_DASHBOARD=true (route allowlist only).
 * - private — dashboard requires basic auth, plus an optional Tailscale gate
 *             (allowlisted Tailscale-User-Login, X-VanOS-Edge, or CGNAT
 *             100.64.0.0/10 when VANOS_TRUST_TAILSCALE_CGNAT=true).
 *             Public ingest stays closed unless VANOS_PUBLIC_INGEST=true.
 *
 * These two are read as static `process.env.*` property access. A dynamic
 * `process.env[name]` lookup is dropped from the Next proxy bundle, so the
 * edge host would not see VANOS_ACCESS_MODE and would fall through to hybrid.
 */
function accessModeRaw(): string {
  const named = process.env.VANOS_ACCESS_MODE ?? process.env.ACCESS_MODE ?? "";
  return named.trim().toLowerCase();
}

/**
 * Opt-in: also serve the dashboard UI, the APIs it calls, and static assets
 * on an edge host. Only the exact value `true` opens that surface.
 * Anything else, including unset, keeps the strict 404.
 *
 * Static property access so the Next proxy bundle keeps the variable.
 * This is a route allowlist, not an auth bypass. When dashboard basic auth
 * is configured, those routes still require it.
 */
export function edgeDashboardEnabled(): boolean {
  return process.env.VANOS_EDGE_DASHBOARD?.trim() === "true";
}

/**
 * Public sample deployment. Only the exact value `true` enables it.
 * Dashboard auth is skipped, reads stay on seeded sample data, and
 * writes/ingest are refused. Unset or any other value leaves production
 * and self-hosted behavior unchanged.
 *
 * Static property access so the Next proxy bundle keeps the variable.
 */
export function isDemoMode(): boolean {
  return process.env.VANOS_DEMO_MODE?.trim() === "true";
}

export function getAccessMode(): AccessMode {
  const raw = accessModeRaw();
  if (raw === "public" || raw === "private" || raw === "hybrid" || raw === "edge") {
    return raw;
  }
  // Production default: hybrid (UI locked, ingest public+Bearer).
  // Local `next dev` stays public unless mode is set explicitly.
  if (process.env.NODE_ENV === "development") return "public";
  return "hybrid";
}

export function getEdgeSecret(): string | undefined {
  return env("VANOS_EDGE_SECRET");
}

/** Comma-separated Tailscale-User-Login values, e.g. "jojo@github" */
export function getAllowedTailscaleUsers(): string[] {
  const raw = env("VANOS_ALLOWED_TAILSCALE_USERS") || env("TAILSCALE_ALLOWED_USERS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Comma-separated allowed Host headers (optional harden). */
export function getAllowedHosts(): string[] {
  const raw = env("VANOS_ALLOWED_HOSTS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * When true, bearer ingest paths work without Tailscale.
 * Public and hybrid always allow that wider surface.
 * Edge serves only the narrow ingest/MCP/health routes (handled separately).
 * Private defaults to closed so the VPS does not mirror the public edge.
 */
export function isPublicIngestEnabled(): boolean {
  const mode = getAccessMode();
  if (mode === "public" || mode === "hybrid" || mode === "edge") return true;
  return envBool("VANOS_PUBLIC_INGEST", false);
}

/** Fail closed: UI basic auth required in hybrid/private unless explicitly disabled. */
export function requireBasicAuth(): boolean {
  const mode = getAccessMode();
  if (mode === "public" || mode === "edge") {
    return envBool("VANOS_REQUIRE_BASIC_AUTH", false);
  }
  return envBool("VANOS_REQUIRE_BASIC_AUTH", true);
}

export function getBasicAuth(): { user: string; pass: string } | null {
  const user = env("DASHBOARD_BASIC_USER");
  const pass = env("DASHBOARD_BASIC_PASSWORD");
  if (!user || !pass) return null;
  return { user, pass };
}

export function isDashboardAuthConfigured(): boolean {
  return getBasicAuth() != null;
}

/**
 * Require a Tailscale/edge identity for the dashboard.
 * Default on in private. Set VANOS_REQUIRE_NETWORK_GATE=false to use basic
 * auth alone (still not a public-edge dashboard).
 */
export function requireNetworkGate(): boolean {
  if (getAccessMode() !== "private") return false;
  return envBool("VANOS_REQUIRE_NETWORK_GATE", true);
}

/**
 * Trust a source address in Tailscale CGNAT 100.64.0.0/10 as a private-network
 * signal. Off by default. Enable only on the VPS, where the proxy overwrites
 * the client address. Do not enable on Vercel — forwarded headers are spoofable.
 */
export function trustTailscaleCgnat(): boolean {
  return envBool("VANOS_TRUST_TAILSCALE_CGNAT", false);
}

/**
 * When true, rate limits and auth audit logs take the rightmost untrusted
 * X-Forwarded-For hop (the peer the trusted proxy appended). The socket
 * address is the trusted proxy and is skipped when it appears in the chain.
 * When false, only the socket address is used. Also required before
 * X-Real-IP, forwarded hops, or Tailscale-User-Login are trusted.
 * Set this only behind a reverse proxy that appends or overwrites the
 * client address, and bind the process to localhost. Do not set it on Vercel.
 *
 * Static property access so the Next proxy bundle keeps the variable.
 */
export function trustProxy(): boolean {
  const v = process.env.VANOS_TRUST_PROXY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function getPublicIngestBaseUrl(): string | undefined {
  return (
    env("VANOS_PUBLIC_INGEST_URL") ||
    env("VANOS_PUBLIC_API_BASE") ||
    env("VANOS_API_BASE")
  );
}

export function getPrivateAppUrl(): string | undefined {
  return env("VANOS_PRIVATE_APP_URL") || env("VANOS_TAILSCALE_URL");
}

export function getRateLimitPerMinute(): number {
  const n = Number(env("VANOS_RATE_LIMIT_PER_MIN") || "60");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 60;
}

/**
 * Base32 TOTP secret (RFC 6238). Unset means dashboard MFA is off.
 * Static property access so the Next proxy bundle keeps the variable.
 */
export function getTotpSecret(): string | undefined {
  const raw = process.env.VANOS_TOTP_SECRET?.trim();
  if (!raw) return undefined;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return compact || undefined;
}

export function totpEnabled(): boolean {
  return Boolean(getTotpSecret());
}

/**
 * HMAC key for the dashboard session cookie. Required when TOTP is on.
 * When TOTP is off, a stable value of at least 32 characters is what lets
 * the browser skip Basic auth. The process never generates this. A new
 * value on each boot would sign cookies that die at the next restart.
 *
 * Static property access so the Next proxy bundle keeps the variable.
 */
export function getSessionSecret(): string | undefined {
  const value = process.env.VANOS_SESSION_SECRET?.trim();
  return value || undefined;
}

/**
 * Lifetime of `vanos_session`.
 * `VANOS_SESSION_TTL_DAYS`, default 30, clamped to 1…365.
 * Invalid or empty values use 30 days.
 * `VANOS_SESSION_TTL_SECONDS` is not read.
 *
 * Static property access so the Next proxy bundle keeps the variable.
 */
export function getSessionTtlSeconds(): number {
  const day = 24 * 60 * 60;
  const fallback = 30 * day;
  const raw = process.env.VANOS_SESSION_TTL_DAYS?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 365) * day;
}

/** Failed and successful TOTP submissions per client, per window. */
export function getTotpAttemptLimit(): number {
  const n = Number(process.env.VANOS_TOTP_MAX_ATTEMPTS?.trim() || "5");
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(Math.floor(n), 100);
}

export function getTotpAttemptWindowMs(): number {
  const n = Number(process.env.VANOS_TOTP_ATTEMPT_WINDOW_SEC?.trim() || "300");
  const sec = Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 300;
  return sec * 1000;
}

export function getTotpIssuer(): string {
  return process.env.VANOS_TOTP_ISSUER?.trim() || "VanOS";
}

export function getTotpAccount(): string {
  return (
    process.env.VANOS_TOTP_ACCOUNT?.trim() ||
    process.env.DASHBOARD_BASIC_USER?.trim() ||
    "dashboard"
  );
}

export function securitySummary() {
  const mode = getAccessMode();
  return {
    mode,
    basicAuthConfigured: isDashboardAuthConfigured(),
    requireBasicAuth: requireBasicAuth(),
    requireNetworkGate: requireNetworkGate(),
    publicIngest: isPublicIngestEnabled(),
    trustTailscaleCgnat: trustTailscaleCgnat(),
    edgeDashboard: edgeDashboardEnabled(),
    demo: isDemoMode(),
    edgeSecretConfigured: Boolean(getEdgeSecret()),
    totpEnabled: totpEnabled(),
    allowedTailscaleUsers: getAllowedTailscaleUsers().length,
    allowedHosts: getAllowedHosts().length,
    privateAppUrl: getPrivateAppUrl() ?? null,
    publicIngestUrl: getPublicIngestBaseUrl() ?? null,
  };
}
