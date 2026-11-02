import { NextResponse } from "next/server";
import { categoryTotals, getCostSnapshot } from "@/lib/costs/store";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/costs");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  const snapshot = await getCostSnapshot();
  return NextResponse.json({
    ...snapshot,
    byCategoryDaily: categoryTotals(snapshot.lines),
    ingest: {
      path: "/api/costs/ingest",
      auth: "Authorization: Bearer $BOTS_INGEST_SECRET (same as Grok Bot ingest)",
    },
  });
}
