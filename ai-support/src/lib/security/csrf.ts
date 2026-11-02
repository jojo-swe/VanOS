import { NextResponse } from "next/server";
import { authorizeAgent } from "@/lib/agent-api/auth";
import { getBasicAuth } from "./config";
import { authorizeDashboardOrAgent } from "./dashboard-auth";

export function hasJsonContentType(req: Request): boolean {
  const raw = req.headers.get("content-type");
  if (!raw) return false;
  const type = raw.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

function addOrigin(origins: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  try {
    origins.add(new URL(value).origin);
  } catch {
    /* not a URL */
  }
}

/** Origins this app will treat as its own for a browser mutation. */
export function appOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  addOrigin(origins, req.url);
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim();
  if (host) {
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  }
  addOrigin(origins, process.env.VANOS_PRIVATE_APP_URL);
  addOrigin(origins, process.env.VANOS_TAILSCALE_URL);
  addOrigin(origins, process.env.VANOS_PUBLIC_INGEST_URL);
  addOrigin(origins, process.env.VANOS_PUBLIC_API_BASE);
  addOrigin(origins, process.env.VANOS_API_BASE);
  return origins;
}

export type CsrfFailure = "content_type" | "origin" | "fetch_site";

/**
 * Browser basic-auth mutations must be JSON and same-origin.
 * A missing Origin and Sec-Fetch-Site is a non-browser client and is allowed.
 * A present Origin must be this app. A present Sec-Fetch-Site must be
 * same-origin or none (a user agent with no referring site).
 */
export function basicAuthCsrfFailure(req: Request): CsrfFailure | null {
  if (!hasJsonContentType(req)) return "content_type";

  const origin = req.headers.get("origin")?.trim();
  if (origin) {
    let parsed: string;
    try {
      parsed = new URL(origin).origin;
    } catch {
      return "origin";
    }
    if (!appOrigins(req).has(parsed)) return "origin";
  }

  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return "fetch_site";
  return null;
}

export function csrfErrorResponse(failure: CsrfFailure): NextResponse {
  const error =
    failure === "content_type"
      ? "Content-Type must be application/json"
      : "Cross-origin request rejected";
  return NextResponse.json({ error }, { status: 403 });
}

/**
 * CSRF gate for mutations a browser will retry with cached basic auth.
 * Agent bearer is not an ambient credential, so it skips the check.
 *
 * X-VanOS-Edge does not skip it. Caddy adds that header to every request,
 * including ones a hostile page makes the browser send, so it says where a
 * request came through, not who sent it. Everyone else must pass the check
 * and then present basic auth or a session, unless development has no
 * password configured.
 */
export function guardBasicAuthMutation(req: Request): NextResponse | null {
  if (authorizeAgent(req)) return null;

  const failure = basicAuthCsrfFailure(req);
  if (failure) return csrfErrorResponse(failure);

  const creds = getBasicAuth();
  if (!creds && process.env.NODE_ENV === "development") return null;
  if (!authorizeDashboardOrAgent(req, { allowEdgeSecret: false })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
