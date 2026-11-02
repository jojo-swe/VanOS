import { NextResponse } from "next/server";
import { getBasicAuth, totpEnabled } from "@/lib/security/config";
import { basicCredentialsMatch } from "@/lib/security/dashboard-auth";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { applySecurityHeaders, isHttpsRequest } from "@/lib/security/headers";
import { logMfaFail } from "@/lib/security/access-log";
import {
  applySessionCookie,
  mfaChallengeHtml,
  mfaSubmissionAllowed,
  safeNextPath,
  submitTotp,
} from "@/lib/security/totp";

export const dynamic = "force-dynamic";

function html(req: Request, status: number, body: string, flag: string): NextResponse {
  const res = new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-VanOS-MFA": flag,
      "Cache-Control": "no-store",
    },
  });
  return applySecurityHeaders(res, { https: isHttpsRequest(req) });
}

async function readSubmission(req: Request): Promise<{ code: string; next: string } | null> {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  try {
    if (type === "application/json") {
      const body = (await req.json()) as { code?: unknown; next?: unknown };
      return {
        code: typeof body.code === "string" ? body.code : "",
        next: safeNextPath(typeof body.next === "string" ? body.next : undefined),
      };
    }
    if (type === "application/x-www-form-urlencoded") {
      const form = await req.formData();
      const code = form.get("code");
      const next = form.get("next");
      return {
        code: typeof code === "string" ? code : "",
        next: safeNextPath(typeof next === "string" ? next : undefined),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Exchange a TOTP or recovery code for a session cookie.
 * The proxy only forwards this after basic auth. TOTP unset → 404.
 */
export async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const denied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (denied) return denied;
  if (!totpEnabled()) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  const creds = getBasicAuth();
  if (!creds || !basicCredentialsMatch(req, creds)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="VanOS Mission Control"',
        "cache-control": "no-store",
      },
    });
  }

  if (!mfaSubmissionAllowed(req)) {
    logMfaFail(req, "cross_origin");
    return applySecurityHeaders(
      NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 }),
      { https: isHttpsRequest(req) },
    );
  }

  const submitted = await readSubmission(req);
  if (!submitted) {
    logMfaFail(req, "missing_code");
    return html(req, 401, mfaChallengeHtml("/dashboard", "That code was not accepted."), "failed");
  }

  const result = await submitTotp(req, submitted.code);
  if (!result.ok) {
    if (result.status === 429) {
      return applySecurityHeaders(
        new NextResponse("Too many attempts", {
          status: 429,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "retry-after": String(result.retryAfter ?? 1),
            "x-vanos-mfa": "failed",
            "cache-control": "no-store",
          },
        }),
        { https: isHttpsRequest(req) },
      );
    }
    if (result.status === 503) {
      return applySecurityHeaders(
        new NextResponse("MFA is unavailable", {
          status: 503,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "x-vanos-mfa": "failed",
            "cache-control": "no-store",
          },
        }),
        { https: isHttpsRequest(req) },
      );
    }
    return html(req, 401, mfaChallengeHtml(submitted.next, "That code was not accepted."), "failed");
  }

  // Relative Location. NextResponse.redirect() absolutizes against req.url,
  // which behind a reverse proxy is the bind address (https://0.0.0.0:3000).
  const location = safeNextPath(submitted.next);
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
  applySessionCookie(res, result.token);
  return applySecurityHeaders(res, { https: isHttpsRequest(req) });
}
