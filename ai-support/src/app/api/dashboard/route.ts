import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard/data";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/dashboard");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await getDashboardData());
}
