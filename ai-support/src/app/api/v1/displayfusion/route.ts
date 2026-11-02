import { NextResponse } from "next/server";
import {
  authorizeAgent,
  isAgentApiConfigured,
  notConfigured,
  unauthorized,
} from "@/lib/agent-api/auth";
import { matchDfCommand, parseDfArgs } from "@/lib/displayfusion/config";
import { dispatchDfRun, getDfSnapshot } from "@/lib/displayfusion/store";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

export const GET = withRequestLog(async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);
  return NextResponse.json(await getDfSnapshot());
});

export const POST = withRequestLog(withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;
  if (raw.action === "list" || raw.action === "snapshot") {
    return NextResponse.json(await getDfSnapshot());
  }

  const parsedArgs = parseDfArgs(raw.args);
  if (!parsedArgs.ok) {
    return NextResponse.json({ error: parsedArgs.error }, { status: 400 });
  }
  const args = parsedArgs.args;
  const matched = matchDfCommand({
    scriptId: typeof raw.scriptId === "string" ? raw.scriptId : undefined,
    command: typeof raw.command === "string" ? raw.command : undefined,
    functionName:
      typeof raw.functionName === "string" ? raw.functionName : undefined,
  });
  if (!matched.ok) {
    return NextResponse.json({ error: matched.error }, { status: 400 });
  }

  const { run, snapshot } = await dispatchDfRun({
    scriptId: matched.scriptId,
    command: matched.command,
    args,
    reportedBy:
      typeof raw.reportedBy === "string" ? raw.reportedBy : "agent-api",
  });

  return NextResponse.json({ ok: run.accepted, run, snapshot });
}));
