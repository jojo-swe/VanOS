import { NextResponse } from "next/server";
import { getMoneySnapshot } from "@/lib/money/store";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { isDemoMode } from "@/lib/security/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/money");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  const snapshot = await getMoneySnapshot();
  return NextResponse.json({
    ...snapshot,
    ingest: {
      path: "/api/money/ingest",
      auth: "Authorization: Bearer $BOTS_INGEST_SECRET",
    },
    // One-tap actions (mark paid, cancel, sold). Off in the read-only demo.
    actions: { path: "/api/money/action", enabled: !isDemoMode() },
  });
}
