import { NextResponse } from "next/server";
import { edgeDashboardEnabled, getAccessMode, isDemoMode } from "@/lib/security/config";
import { edgeSurface } from "@/lib/security/paths";

/**
 * Real 404 for a closed edge path. Route handlers call this before any
 * store read so a request that reaches the function (proxy skipped) still
 * cannot return dashboard or API data.
 */
export function denyIfEdgeClosed(pathname: string): NextResponse | null {
  if (getAccessMode() !== "edge") return null;
  const dashboard = edgeDashboardEnabled() || isDemoMode();
  if (edgeSurface(pathname, dashboard) !== "closed") return null;
  return new NextResponse("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
      "x-vanos-access-mode": "edge",
    },
  });
}
