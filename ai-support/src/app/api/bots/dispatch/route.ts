import { NextResponse } from "next/server";
import { dispatchToBot } from "@/lib/bots/dispatch";
import { guardBasicAuthMutation } from "@/lib/security/csrf";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

/**
 * Dispatch a task to a Grok Bot routine webhook.
 * Body: { botId: string, task: string, context?: object }
 *
 * Requires dashboard basic auth or AGENT_API_TOKEN.
 * Basic-auth callers must send application/json from this app's origin.
 * Agents on the public edge should prefer POST /api/v1/dispatch.
 */
export const POST = withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  const blocked = guardBasicAuthMutation(req);
  if (blocked) return blocked;

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;
  const result = await dispatchToBot(raw, {
    origin: new URL(req.url).origin,
    source: "vanos-mission-control",
  });
  if (result.kind === "rejected") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    {
      ok: result.accepted,
      dispatch: result.record,
      note: result.accepted
        ? "Grok Bot accepted the run (HTTP 200). Result will appear after the Bot POSTs to /api/bots/ingest."
        : "Grok Bot did not accept the run. Check webhook URL/key and that the routine is not paused.",
    },
    { status: result.accepted ? 200 : 502 },
  );
});
