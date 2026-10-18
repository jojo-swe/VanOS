import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeAgent } from "@/lib/agent-api/auth";
import { getAccessMode, getBasicAuth, isDemoMode } from "./config";
import { resolveNetworkIdentity } from "./identity";
import { requestHasValidSession } from "./session";
import { timingSafeEqualString } from "./timing";

type HeaderSource = { get(name: string): string | null };

/** Fixed-length digest, so the compare below takes the same time for any input length. */
function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

/**
 * Compare a presented Basic credential with the configured one in constant
 * time. Both the user name and the password are always compared, and the
 * results are combined without short-circuiting, so a wrong user name takes
 * as long as a wrong password. Each side is hashed first, so the time does
 * not depend on how long either value is.
 */
export function credentialsMatch(
  presented: { user: string; pass: string },
  creds: { user: string; pass: string },
): boolean {
  const userOk = timingSafeEqualString(digest(presented.user), digest(creds.user));
  const passOk = timingSafeEqualString(digest(presented.pass), digest(creds.pass));
  return (Number(userOk) & Number(passOk)) === 1;
}

export function basicCredentialsMatch(
  req: { headers: HeaderSource },
  creds: { user: string; pass: string },
): boolean {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(auth.slice(6));
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  const user = i >= 0 ? decoded.slice(0, i) : decoded;
  const pass = i >= 0 ? decoded.slice(i + 1) : "";
  return credentialsMatch({ user, pass }, creds);
}

/**
 * True when dashboard basic auth is unset, the request presents it, or a
 * valid `vanos_session` cookie is bound to the current password and TOTP secret.
 * Agent bearer is not a substitute. Accepts a header bag (Request.headers or
 * next/headers) so pages and routes share it.
 */
export function dashboardReadAuthorized(headers: HeaderSource): boolean {
  if (isDemoMode()) return true;
  const creds = getBasicAuth();
  // No password configured: open only for local development or an explicit
  // public mode. Anywhere else (an edge host with VANOS_EDGE_DASHBOARD, a
  // hybrid deploy missing its env) the read APIs stay closed.
  if (!creds) return process.env.NODE_ENV === "development" || getAccessMode() === "public";
  if (basicCredentialsMatch({ headers }, creds)) return true;
  return requestHasValidSession(headers);
}

export function denyDashboardRead(req: Request): NextResponse | null {
  if (dashboardReadAuthorized(req.headers)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Allow dashboard UI (basic auth or a valid session cookie) or agent Bearer
 * (AGENT_API_TOKEN). Used by Home Assistant, bot dispatch, DisplayFusion,
 * and the read-only integration panels.
 *
 * The session cookie is the browser credential. It is not an agent token
 * and does not authorize `/api/v1/*`.
 *
 * Does not trust Tailscale-User-Login alone.
 * X-VanOS-Edge is accepted only when allowEdgeSecret is not false.
 * DisplayFusion passes false: the edge header is a network signal, not a
 * permission to run commands.
 */
export function authorizeDashboardOrAgent(
  req: Request,
  opts?: { allowEdgeSecret?: boolean },
): boolean {
  if (isDemoMode()) return true;
  if (authorizeAgent(req)) return true;

  if (opts?.allowEdgeSecret !== false) {
    const identity = resolveNetworkIdentity(req);
    if (identity.ok && identity.via === "edge-secret") return true;
  }

  const creds = getBasicAuth();
  if (!creds) {
    return process.env.NODE_ENV === "development";
  }
  if (basicCredentialsMatch(req, creds)) return true;
  return requestHasValidSession(req.headers);
}
