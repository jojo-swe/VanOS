import { NextResponse } from "next/server";
import { logLogout } from "@/lib/security/access-log";
import { getBasicAuth, isDemoMode } from "@/lib/security/config";
import { appOrigins } from "@/lib/security/csrf";
import { basicCredentialsMatch } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { applySecurityHeaders, isHttpsRequest } from "@/lib/security/headers";
import { revokeAllSessions } from "@/lib/security/session-generation";
import { clearSessionCookie, requestHasCurrentSession } from "@/lib/security/session";

export const dynamic = "force-dynamic";

/**
 * Sign out: clear `vanos_session` and revoke every session.
 *
 * Revocation stores a new session generation, so every cookie signed before
 * it (including a copied one) stops working at once on this instance, and
 * within the generation cache window on any other. It runs only when this
 * request is itself authenticated (a current session cookie or the Basic
 * credential), so an unauthenticated caller cannot sign the owner out
 * everywhere. Without that, only this browser's cookie is cleared.
 *
 * A cross-origin request is rejected and changes nothing, so a third-party
 * page cannot sign the browser out.
 */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin")?.trim();
  if (!origin) return true;
  if (origin === "null") return site === "same-origin";
  try {
    return appOrigins(req).has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function authenticated(req: Request): Promise<boolean> {
  const creds = getBasicAuth();
  if (creds && basicCredentialsMatch(req, creds)) return true;
  return await requestHasCurrentSession(req.headers);
}

async function logout(req: Request): Promise<NextResponse> {
  const denied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (denied) return denied;
  if (!sameOrigin(req)) {
    return applySecurityHeaders(
      NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 }),
      { https: isHttpsRequest(req) },
    );
  }

  if (!isDemoMode() && (await authenticated(req))) {
    const revoked = await revokeAllSessions();
    logLogout(req, revoked);
    if (!revoked) {
      // Fail visibly: the browser is signed out, but a copied cookie would
      // still work, so do not pretend the logout is complete.
      const res = new NextResponse(
        "Signed out in this browser, but other sessions could not be revoked because storage is unavailable. Try again shortly.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
        },
      );
      clearSessionCookie(res);
      return applySecurityHeaders(res, { https: isHttpsRequest(req) });
    }
  }

  const res = new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/",
      "Cache-Control": "no-store",
    },
  });
  clearSessionCookie(res);
  return applySecurityHeaders(res, { https: isHttpsRequest(req) });
}

export async function GET(req: Request): Promise<NextResponse> {
  return logout(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return logout(req);
}
