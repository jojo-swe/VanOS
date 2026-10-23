import { NextResponse } from "next/server";
import { getConnectionsSnapshot } from "@/lib/connections/store";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/connections");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  const snapshot = await getConnectionsSnapshot();
  return NextResponse.json({
    ...snapshot,
    ingest: {
      path: "/api/connections/ingest",
      auth: "Authorization: Bearer $BOTS_INGEST_SECRET",
    },
  });
}
