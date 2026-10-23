import { NextResponse } from "next/server";
import { getSlackSnapshot } from "@/lib/slack/snapshot";
import { authorizeDashboardOrAgent } from "@/lib/security/dashboard-auth";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!authorizeDashboardOrAgent(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const snapshot = await getSlackSnapshot();
  return NextResponse.json({ ...snapshot, docs: "INTEGRATIONS.md" });
}
