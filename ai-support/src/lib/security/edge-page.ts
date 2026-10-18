import { notFound } from "next/navigation";
import { edgeDashboardEnabled, getAccessMode, isDemoMode } from "@/lib/security/config";

/**
 * Stop a page from rendering on the public edge host.
 * Call this from a page or a nested layout, not the root layout:
 * notFound() in the root layout has no parent boundary and can answer 200.
 */
export function refuseEdgePage(): void {
  if (isDemoMode()) return;
  if (getAccessMode() === "edge" && !edgeDashboardEnabled()) notFound();
}
