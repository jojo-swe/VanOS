import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/sync/setup";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

/** Public wire checklist for Mission Control Setup panel (no secrets). */
export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/setup");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  const status = await getSetupStatus();
  return NextResponse.json(status);
}
