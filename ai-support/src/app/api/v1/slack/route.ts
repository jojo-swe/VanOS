import { NextResponse } from "next/server";
import {
  authorizeAgent,
  isAgentApiConfigured,
  notConfigured,
  unauthorized,
} from "@/lib/agent-api/auth";
import { getSlackSnapshot } from "@/lib/slack/snapshot";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withRequestLog(async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);
  return NextResponse.json(await getSlackSnapshot());
});
