import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { demoEndpointDisabled, demoWriteResponse } from "@/lib/demo/mode";
import {
  edgeDashboardEnabled,
  getAccessMode,
  getAllowedHosts,
  getBasicAuth,
  getRateLimitPerMinute,
  isDemoMode,
  isPublicIngestEnabled,
  requireBasicAuth,
  requireNetworkGate,
  totpEnabled,
} from "@/lib/security/config";
import { resolveNetworkIdentity } from "@/lib/security/identity";
import { applySecurityHeaders, isHttpsRequest } from "@/lib/security/headers";
import {
  logAuthFail,
  logAuthOk,
  logProxyResponse,
  requestPath,
  socketAddress,
} from "@/lib/security/access-log";
import {
  BRIDGE_CALLBACK_PATHS,
  classifyPath,
  edgeSurface,
  normalizePath,
} from "@/lib/security/paths";
import { presentsDfBridgeSecret } from "@/lib/displayfusion/config";
import { clientIp, rateLimitConsume } from "@/lib/security/rate-limit";
import { basicCredentialsMatch } from "@/lib/security/dashboard-auth";
import {
  applySessionCookie,
  issueSessionToken,
  requestHasCurrentSession,
} from "@/lib/security/session";
import {
  evaluateTotp,
  mfaChallengeHtml,
  safeNextPath,
} from "@/lib/security/totp";

const startedAt = new WeakMap<Request, number>();
const issuedSession = new WeakMap<Request, string>();

function elapsed(req: Request): number {
  const started = startedAt.get(req);
  return started === undefined ? 0 : Date.now() - started;
}

/** Continue, and pass the socket address inward for the access log. */
function forward(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set("x-vanos-socket-ip", socketAddress(req));
  return NextResponse.next({ request: { headers } });
}

function deny(
  req: NextRequest,
  status: number,
  body: string,
  extra?: HeadersInit,
): NextResponse {
  const res = new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extra,
    },
  });
  const secured = applySecurityHeaders(res, { https: isHttpsRequest(req) });
  logProxyResponse(req, status, elapsed(req));
  return secured;
}

function denyJson(
  req: NextRequest,
  status: number,
  error: string,
  extra?: HeadersInit,
): NextResponse {
  const res = NextResponse.json(
    { error },
    { status, headers: extra },
  );
  const secured = applySecurityHeaders(res, { https: isHttpsRequest(req) });
  logProxyResponse(req, status, elapsed(req));
  return secured;
}

function checkBasicAuth(req: NextRequest): "ok" | "missing-config" | "bad" {
  const creds = getBasicAuth();
  if (!creds) return "missing-config";
  return basicCredentialsMatch(req, creds) ? "ok" : "bad";
}

function stampSession(req: NextRequest, res: NextResponse): void {
  const token = issuedSession.get(req);
  if (!token) return;
  applySessionCookie(res, token);
}

function isLogoutPath(pathname: string): boolean {
  return normalizePath(pathname) === "/api/auth/logout";
}

/**
 * Dashboard credential gate.
 * A valid session cookie of the current session generation skips Basic
 * auth and TOTP. Otherwise Basic is required, then TOTP when it is
 * configured. After that succeeds, a session cookie is issued when
 * VANOS_SESSION_SECRET is set and storage can name the current generation.
 * Logout is not gated here: the route clears the cookie, revokes every
 * session only when the request itself is authenticated, and rejects
 * cross-origin calls.
 */
async function gateDashboard(req: NextRequest): Promise<NextResponse | null> {
  if (await requestHasCurrentSession(req.headers)) {
    logAuthOk(req);
    return null;
  }

  const basic = checkBasicAuth(req);
  if (basic === "missing-config") {
    return deny(
      req,
      503,
      "Dashboard auth not configured. Set DASHBOARD_BASIC_USER and DASHBOARD_BASIC_PASSWORD (required in hybrid/private).",
    );
  }
  if (basic === "bad") return await rejectBadBasic(req);
  logAuthOk(req);
  const blocked = await enforceTotp(req);
  if (blocked) return blocked;
  if (!totpEnabled()) {
    const token = await issueSessionToken();
    if (token) issuedSession.set(req, token);
  }
  return null;
}

/**
 * TOTP runs only after basic auth has succeeded.
 * A valid session cookie or an agent token skips it. Unset TOTP skips it.
 */
async function enforceTotp(req: NextRequest): Promise<NextResponse | null> {
  const decision = await evaluateTotp(req);
  if (decision.kind === "skip" || decision.kind === "continue") return null;
  if (decision.kind === "session") {
    issuedSession.set(req, decision.token);
    return null;
  }
  if (decision.kind === "challenge") {
    return mfaPage(req, 401, mfaChallengeHtml(safeNextPath(requestPath(req))), "required");
  }
  if (decision.status === 401) {
    return mfaPage(
      req,
      401,
      mfaChallengeHtml(safeNextPath(requestPath(req)), "That code was not accepted."),
      "failed",
    );
  }
  const body =
    decision.status === 429
      ? "Too many attempts"
      : decision.status === 403
        ? "Cross-origin request rejected"
        : "MFA is unavailable";
  const extra: Record<string, string> = { "X-VanOS-MFA": "failed" };
  if (decision.retryAfter) extra["Retry-After"] = String(decision.retryAfter);
  const res = new NextResponse(body, {
    status: decision.status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extra,
    },
  });
  const secured = applySecurityHeaders(res, { https: isHttpsRequest(req) });
  logProxyResponse(req, decision.status, elapsed(req));
  return secured;
}

function mfaPage(req: NextRequest, status: number, html: string, flag: string): NextResponse {
  const res = new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-VanOS-MFA": flag,
      "Cache-Control": "no-store",
    },
  });
  const secured = applySecurityHeaders(res, { https: isHttpsRequest(req) });
  logProxyResponse(req, status, elapsed(req));
  return secured;
}

function denyDemo(req: NextRequest): NextResponse {
  const res = demoWriteResponse();
  const secured = applySecurityHeaders(res, { https: isHttpsRequest(req) });
  logProxyResponse(req, 403, elapsed(req));
  return secured;
}

function markDemo(res: NextResponse): void {
  if (isDemoMode()) res.headers.set("X-VanOS-Demo", "true");
}

function challenge(req: NextRequest): NextResponse {
  logAuthFail(req, "basic_auth_fail");
  return deny(req, 401, "Authentication required", {
    "WWW-Authenticate": 'Basic realm="VanOS Mission Control"',
  });
}

/** Count a failed basic-auth attempt, then challenge or return 429. */
async function rejectBadBasic(req: NextRequest): Promise<NextResponse> {
  const limit = await consumeLimit(req, `basic-auth:${clientIp(req)}`);
  if (!limit.ok) return limit.response;
  return challenge(req);
}

function hostAllowed(req: NextRequest): boolean {
  const allowed = getAllowedHosts();
  if (!allowed.length) return true;
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  return allowed.includes(host);
}

async function consumeLimit(
  req: NextRequest,
  bucket: string,
): Promise<{ ok: true; remaining: number } | { ok: false; response: NextResponse }> {
  const rl = await rateLimitConsume(bucket, getRateLimitPerMinute());
  if (!rl.ok) {
    logAuthFail(req, "rate_limited");
    return {
      ok: false,
      response: denyJson(req, 429, "Rate limit exceeded", {
        "Retry-After": String(
          Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
        ),
        "X-RateLimit-Remaining": "0",
      }),
    };
  }
  return { ok: true, remaining: rl.remaining };
}

/**
 * Edge deployment: bot ingest, the Grok MCP connector, and health.
 * The dashboard, its APIs, and static assets stay 404 unless
 * VANOS_EDGE_DASHBOARD=true. The flag does not skip credentials.
 */
async function handleEdge(req: NextRequest, path: string): Promise<NextResponse> {
  const https = isHttpsRequest(req);
  const surface = edgeSurface(path, edgeDashboardEnabled() || isDemoMode());
  if (surface === "closed") return deny(req, 404, "Not found");

  if (surface === "static") {
    const res = forward(req);
    res.headers.set("X-VanOS-Access-Mode", "edge");
    return res;
  }

  if (surface === "dashboard") {
    // Always gate. With no DASHBOARD_BASIC_* set, gateDashboard answers 503
    // instead of serving the dashboard to anyone on the internet.
    if (!isDemoMode() && !isLogoutPath(path)) {
      const blocked = await gateDashboard(req);
      if (blocked) return blocked;
    }
    const res = forward(req);
    stampSession(req, res);
    res.headers.set("X-VanOS-Access-Mode", "edge");
    markDemo(res);
    return applySecurityHeaders(res, { https });
  }

  const ip = clientIp(req);
  const bucket =
    surface === "health"
      ? `health:${ip}`
      : path.startsWith("/api/mcp")
        ? `mcp-http:${ip}`
        : `ingest:${ip}`;
  const limit = await consumeLimit(req, bucket);
  if (!limit.ok) return limit.response;

  const res = forward(req);
  res.headers.set("X-VanOS-Access-Mode", "edge");
  res.headers.set("X-RateLimit-Remaining", String(limit.remaining));
  return applySecurityHeaders(res, { https });
}

/**
 * VanOS access gate.
 *
 * Next.js 16 runs this file as `src/proxy.ts` (the `middleware.ts` name is
 * deprecated). It has to sit next to `app/` — `ai-support/src/proxy.ts` —
 * because that directory is the Next root Vercel builds.
 *
 * Modes: VANOS_ACCESS_MODE = public | hybrid | private | edge
 * - hybrid (default in production): UI basic-auth fail-closed; wider bearer surface
 * - edge: only /api/bots/ingest, /api/mcp, and /api/v1/health
 *   (plus the dashboard surface when VANOS_EDGE_DASHBOARD=true)
 * - private: dashboard behind basic auth; Tailscale headers and/or CGNAT when configured
 * - public: basic auth optional (dev)
 *
 * Bearer validation for agent routes still happens in route handlers;
 * the proxy enforces network/UI policy and rate limits. A closed path
 * answers with status 404 here, before any page or route handler runs.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  startedAt.set(req, Date.now());
  const path = req.nextUrl.pathname;
  const kind =
    BRIDGE_CALLBACK_PATHS.includes(normalizePath(path)) && presentsDfBridgeSecret(req)
      ? "public_bearer"
      : classifyPath(path);
  const https = isHttpsRequest(req);
  const mode = getAccessMode();

  if (demoEndpointDisabled(req.method, path)) return denyDemo(req);

  if (kind === "static_skip") {
    if (mode === "edge" && !edgeDashboardEnabled() && !isDemoMode()) {
      return deny(req, 404, "Not found");
    }
    return forward(req);
  }

  if (!hostAllowed(req)) {
    return denyJson(req, 421, "Host not allowed");
  }

  if (mode === "edge") return await handleEdge(req, path);

  const identity = resolveNetworkIdentity(req);

  // --- Public bearer paths (Grok / n8n / OpenClaw writes) ---
  if (kind === "public_bearer") {
    if (!isPublicIngestEnabled() && !identity.ok) {
      return denyJson(
        req,
        403,
        "Public ingest disabled. Use Tailscale/edge or set VANOS_PUBLIC_INGEST=true",
      );
    }
    const ip = clientIp(req);
    const bucket = path.startsWith("/api/mcp") ? `mcp-http:${ip}` : `ingest:${ip}`;
    const limit = await consumeLimit(req, bucket);
    if (!limit.ok) return limit.response;
    const res = forward(req);
    res.headers.set("X-RateLimit-Remaining", String(limit.remaining));
    return applySecurityHeaders(res, { https });
  }

  // --- Sparse public health/discovery (no secrets; further trimmed in handlers) ---
  if (kind === "public_sparse") {
    const res = forward(req);
    res.headers.set("X-VanOS-Access-Mode", mode);
    if (identity.ok) res.headers.set("X-VanOS-Network", identity.via);
    return applySecurityHeaders(res, { https });
  }

  // --- Agent read (snapshot): Tailscale/edge OR will be Bearer-checked in route ---
  if (kind === "agent_read") {
    if (mode === "private" && !identity.ok && !isPublicIngestEnabled()) {
      // allow through for Bearer — route still enforces token
    }
    const ip = clientIp(req);
    const rl = await rateLimitConsume(`agent:${ip}`, getRateLimitPerMinute());
    if (!rl.ok) {
      logAuthFail(req, "rate_limited");
      return denyJson(req, 429, "Rate limit exceeded");
    }
    return applySecurityHeaders(forward(req), { https });
  }

  // --- Private UI + read APIs ---
  // Demo mode is a public sample. It does not require Tailscale or Basic auth.
  if (!isDemoMode() && requireNetworkGate()) {
    if (!identity.ok) {
      return deny(
        req,
        403,
        `Private access only (Tailscale / edge). ${identity.detail}`,
      );
    }
  }

  // Logout clears the cookie. Challenging here would prompt for Basic
  // auth just to sign out. The route rejects cross-origin calls, and only
  // an authenticated request (current session or Basic) revokes sessions.
  if (!isDemoMode() && !isLogoutPath(path) && (requireBasicAuth() || getBasicAuth())) {
    const blocked = await gateDashboard(req);
    if (blocked) return blocked;
  }

  const res = forward(req);
  stampSession(req, res);
  markDemo(res);
  res.headers.set("X-VanOS-Access-Mode", mode);
  if (!isDemoMode() && identity.ok) {
    res.headers.set("X-VanOS-Network", identity.via);
    if (identity.login) res.headers.set("X-VanOS-Tailscale-User", identity.login);
  }
  return applySecurityHeaders(res, { https });
}

export const config = {
  matcher: ["/", "/:path*"],
};
