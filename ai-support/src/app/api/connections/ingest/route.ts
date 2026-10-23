import { NextResponse } from "next/server";
import { authorizeIngest } from "@/lib/bots/auth";
import { isIngestConfigured } from "@/lib/bots/config";
import { parseConnectionsIngest } from "@/lib/connections/parse-ingest";
import { applyConnectionsIngest } from "@/lib/connections/store";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

export const POST = withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isIngestConfigured()) {
    return NextResponse.json(
      {
        error:
          "Ingest not configured. Set BOTS_INGEST_SECRET in the environment.",
      },
      { status: 503 },
    );
  }
  if (!authorizeIngest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const parsed = parseConnectionsIngest((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const snapshot = await applyConnectionsIngest(parsed.payload);
  return NextResponse.json({ ok: true, snapshot });
});

export async function GET(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed("/api/connections/ingest");
  if (edgeDenied) return edgeDenied;
  return NextResponse.json({
    ok: true,
    configured: isIngestConfigured(),
    usage:
      "POST JSON with Bearer BOTS_INGEST_SECRET. Body: { mail?, github?, notion?, joplin?, gdrive?, connections?, reportedBy?, replace? }",
  });
}
