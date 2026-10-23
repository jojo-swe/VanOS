import { NextResponse } from "next/server";
import {
  dispatchDfRun,
  getDfSnapshot,
  ingestDfResult,
} from "@/lib/displayfusion/store";
import { authorizeDashboardOrAgent } from "@/lib/security/dashboard-auth";
import { guardBasicAuthMutation } from "@/lib/security/csrf";
import {
  matchDfCommand,
  parseDfArgs,
  presentsDfBridgeSecret,
} from "@/lib/displayfusion/config";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!authorizeDashboardOrAgent(req, { allowEdgeSecret: false })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const snapshot = await getDfSnapshot();
  return NextResponse.json({ ...snapshot, docs: "HOME-LAB.md" });
}

/** Run a DisplayFusion script/function via the Windows bridge */
export const POST = withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;

  // The proxy lets bridge-secret requests skip the dashboard gate, so they
  // may only post results back. Everyone else passes CSRF and basic auth.
  const bridge = presentsDfBridgeSecret(req);
  if (!bridge) {
    const blocked = guardBasicAuthMutation(req);
    if (blocked) return blocked;
  }

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;

  // Bridge result callback — DF secret only (no Tailscale / basic auth)
  const isCallback = raw.type === "result" || raw.callback === true;
  if (isCallback !== bridge) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isCallback) {
    const run = await ingestDfResult({
      runId: typeof raw.runId === "string" ? raw.runId : undefined,
      command: typeof raw.command === "string" ? raw.command : undefined,
      ok: Boolean(raw.ok),
      summary: typeof raw.summary === "string" ? raw.summary : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
      reportedBy:
        typeof raw.reportedBy === "string" ? raw.reportedBy : undefined,
    });
    return NextResponse.json({ ok: true, run });
  }

  // Mutating run — agent token or dashboard basic auth. Not X-VanOS-Edge.
  if (!authorizeDashboardOrAgent(req, { allowEdgeSecret: false })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedArgs = parseDfArgs(raw.args);
  if (!parsedArgs.ok) {
    return NextResponse.json({ error: parsedArgs.error }, { status: 400 });
  }
  const args = parsedArgs.args;
  const requested = {
    scriptId: typeof raw.scriptId === "string" ? raw.scriptId : undefined,
    command: typeof raw.command === "string" ? raw.command : undefined,
    functionName:
      typeof raw.functionName === "string" ? raw.functionName : undefined,
  };
  const matched = matchDfCommand(requested);
  if (!matched.ok) {
    return NextResponse.json({ error: matched.error }, { status: 400 });
  }

  const { run, snapshot } = await dispatchDfRun({
    scriptId: matched.scriptId,
    command: matched.command,
    args,
    reportedBy:
      typeof raw.reportedBy === "string" ? raw.reportedBy : "dashboard",
  });

  return NextResponse.json({
    ok: run.accepted,
    run,
    snapshot,
  });
});
