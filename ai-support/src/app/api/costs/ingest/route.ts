import { NextResponse } from "next/server";
import { authorizeIngest } from "@/lib/bots/auth";
import { isIngestConfigured } from "@/lib/bots/config";
import { parseCostIngest } from "@/lib/costs/parse-ingest";
import { applyCostIngest } from "@/lib/costs/store";
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

  const parsed = parseCostIngest((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const snapshot = await applyCostIngest(parsed.payload);
  return NextResponse.json({ ok: true, snapshot });
});

export async function GET(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed("/api/costs/ingest");
  if (edgeDenied) return edgeDenied;
  return NextResponse.json({
    ok: true,
    configured: isIngestConfigured(),
    usage:
      "POST JSON with Authorization: Bearer $BOTS_INGEST_SECRET. Body: { lines: [{ name, provider, category, amountUsd, period? }], replace?, budget?, series?, reportedBy?, mode? }",
  });
}
