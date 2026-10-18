export type PathClass =
  | "public_bearer"
  | "public_sparse"
  | "private_ui"
  | "agent_read"
  | "static_skip";

/**
 * Paths that may be hit from the public internet with Bearer only (no Tailscale).
 * Route handlers must still enforce Bearer / bridge secret.
 *
 * /api/bots/dispatch is intentionally NOT public — dashboard uses private_ui +
 * basic auth; agents use /api/v1/dispatch.
 */
const PUBLIC_BEARER_PREFIXES = [
  "/api/v1/ingest",
  "/api/v1/sync",
  "/api/v1/dispatch",
  "/api/v1/homeassistant",
  "/api/v1/displayfusion",
  "/api/v1/github",
  "/api/v1/notion",
  "/api/v1/obsidian",
  "/api/v1/slack",
  "/api/bots/ingest",
  // Grok Bot connector. Handler requires AGENT_API_TOKEN; dashboard stays private_ui.
  "/api/mcp",
  "/api/costs/ingest",
  "/api/money/ingest",
  "/api/connections/ingest",
];

/**
 * Bridge result callbacks. These count as public_bearer only when the
 * request carries DISPLAYFUSION_BRIDGE_SECRET (checked in the proxy).
 * Without it the path is private_ui, so running a command needs the full
 * dashboard gate including TOTP.
 */
export const BRIDGE_CALLBACK_PATHS = ["/api/displayfusion"];

const PUBLIC_SPARSE_EXACT = ["/api/v1/health", "/api/v1"];

const AGENT_READ_PREFIXES = ["/api/v1/snapshot"];

/**
 * Routes an `edge` deployment may answer. Everything else is 404.
 * Health is unauthenticated and sparse. The two bearer routes still
 * enforce their own tokens in the handlers.
 *
 * With VANOS_EDGE_DASHBOARD=true the UI pages, the APIs those pages
 * fetch, and static assets are also open. Ingest, MCP, and health
 * stay as they are. Agent write routes such as /api/v1/* and the
 * ingest callbacks stay closed.
 */
const EDGE_BEARER_PREFIXES = ["/api/bots/ingest", "/api/mcp"];
const EDGE_HEALTH_EXACT = ["/api/v1/health"];

const EDGE_DASHBOARD_PAGES = ["/", "/dashboard", "/support"];

/** Exact paths the dashboard client fetches. Not their /ingest siblings. */
const EDGE_DASHBOARD_APIS = [
  "/api/dashboard",
  "/api/setup",
  "/api/bots/status",
  "/api/bots/dispatch",
  "/api/connections",
  "/api/costs",
  "/api/money",
  "/api/homeassistant",
  "/api/displayfusion",
  "/api/github",
  "/api/notion",
  "/api/obsidian",
  "/api/slack",
  "/api/auth/mfa",
  "/api/auth/logout",
];

export type EdgeSurface = "bearer" | "health" | "dashboard" | "static" | "closed";

/** Tab and home-screen icons. Served without a dashboard challenge, like favicon.ico. */
const BRAND_ICONS = new Set([
  "/icon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
]);

/** `_next`, favicon, brand icons, robots.txt, and root public/ files (one segment with an extension). */
export function isEdgeStaticAsset(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path.startsWith("/_next")) return true;
  if (path.startsWith("/favicon")) return true;
  if (BRAND_ICONS.has(path)) return true;
  if (path === "/robots.txt") return true;
  return /^\/[^/]+\.[a-z0-9]{1,8}$/i.test(path);
}

export function edgeSurface(pathname: string, dashboard = false): EdgeSurface {
  const path = normalizePath(pathname);
  if (EDGE_HEALTH_EXACT.includes(path)) return "health";
  for (const prefix of EDGE_BEARER_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return "bearer";
  }
  if (!dashboard) return "closed";
  if (isEdgeStaticAsset(path)) return "static";
  if (EDGE_DASHBOARD_PAGES.includes(path)) return "dashboard";
  if (EDGE_DASHBOARD_APIS.includes(path)) return "dashboard";
  return "closed";
}

export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function classifyPath(pathname: string): PathClass {
  const path = normalizePath(pathname);

  if (
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    BRAND_ICONS.has(path) ||
    path === "/robots.txt"
  ) {
    return "static_skip";
  }

  for (const p of PUBLIC_BEARER_PREFIXES) {
    if (path === p || path.startsWith(`${p}/`)) return "public_bearer";
  }

  if (PUBLIC_SPARSE_EXACT.includes(path)) return "public_sparse";

  for (const p of AGENT_READ_PREFIXES) {
    if (path === p || path.startsWith(`${p}/`)) return "agent_read";
  }

  // Everything else is private UI / read APIs / pages
  return "private_ui";
}

export function isPrivateUiPath(pathname: string): boolean {
  return classifyPath(pathname) === "private_ui";
}
