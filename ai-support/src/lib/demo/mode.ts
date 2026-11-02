import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/security/config";
import { normalizePath } from "@/lib/security/paths";

/**
 * Optional public source link for the demo banner.
 * Empty unless VANOS_DEMO_REPO_URL is an http(s) URL, so the demo does not
 * point at a private repository by default.
 */
export function demoRepoUrl(): string {
  const raw = process.env.VANOS_DEMO_REPO_URL?.trim() ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function demoBanner() {
  const href = demoRepoUrl();
  return {
    label: "Demo",
    body: "Sample data only. Sign-in, MFA, live integrations, and writes are off.",
    href,
    link: href ? "Source" : "",
  };
}

/**
 * Whole endpoints that demo mode refuses, including GET.
 * Ingest, dispatch, MCP, sync, and MFA must not run.
 */
const DEMO_DISABLED_PREFIXES = [
  "/api/bots/ingest",
  "/api/bots/dispatch",
  "/api/connections/ingest",
  "/api/costs/ingest",
  "/api/money/ingest",
  "/api/money/action",
  "/api/mcp",
  "/api/v1/ingest",
  "/api/v1/sync",
  "/api/v1/dispatch",
  "/api/auth/mfa",
];

/** Reads stay open. POST/PUT/PATCH/DELETE are refused. */
const DEMO_MUTATION_PREFIXES = [
  "/api/homeassistant",
  "/api/displayfusion",
  "/api/v1/homeassistant",
  "/api/v1/displayfusion",
];

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True only while demo mode is on and this request must not run. */
export function demoEndpointDisabled(method: string, pathname: string): boolean {
  if (!isDemoMode()) return false;
  const path = normalizePath(pathname);
  if (DEMO_DISABLED_PREFIXES.some((prefix) => matches(path, prefix))) return true;
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  return DEMO_MUTATION_PREFIXES.some((prefix) => matches(path, prefix));
}

export function demoWriteResponse(): NextResponse {
  return NextResponse.json(
    { error: "Demo mode is read-only", demo: true },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "x-vanos-demo": "true",
      },
    },
  );
}

/** Route-handler guard. Returns 403 before any store, token, or upstream call. */
export function denyIfDemoRequest(req: Request): NextResponse | null {
  const pathname = new URL(req.url).pathname;
  if (!demoEndpointDisabled(req.method, pathname)) return null;
  return demoWriteResponse();
}
