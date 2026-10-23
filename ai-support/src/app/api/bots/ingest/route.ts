import { NextResponse } from "next/server";
import { authorizeIngest } from "@/lib/bots/auth";
import { isIngestConfigured } from "@/lib/bots/config";
import { acceptBotIngest } from "@/lib/bots/accept";
import { BOT_INGEST_RATE_LIMIT, MAX_INGEST_BYTES } from "@/lib/bots/parse-ingest";
import { logAuthFail, logMissingToken, withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";

export const dynamic = "force-dynamic";

function tooLarge() {
  return NextResponse.json(
    {
      error: `Payload too large (max ${MAX_INGEST_BYTES} bytes)`,
      maxBytes: MAX_INGEST_BYTES,
    },
    { status: 413 },
  );
}

export const POST = withRequestLog(withDurableErrors(async function POST(req: Request) {
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
    logMissingToken(req);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        { error: "Invalid Content-Length" },
        { status: 400 },
      );
    }
    if (n > MAX_INGEST_BYTES) return tooLarge();
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_INGEST_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }

  const accepted = await acceptBotIngest(body as Record<string, unknown>, {
    idempotencyKeyHeader: req.headers.get("idempotency-key"),
  });
  if (!accepted.ok) {
    if (accepted.status === 429) logAuthFail(req, "rate_limited");
    return NextResponse.json(accepted.body, {
      status: accepted.status,
      headers: accepted.headers,
    });
  }
  return NextResponse.json(
    { ok: true, idempotent: accepted.idempotent, event: accepted.event },
    {
      status: 200,
      headers: { "X-RateLimit-Remaining": String(accepted.remaining) },
    },
  );
}));

export const GET = withRequestLog(async function GET(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  return NextResponse.json({
    ok: true,
    configured: isIngestConfigured(),
    maxBytes: MAX_INGEST_BYTES,
    rateLimitPerMinute: BOT_INGEST_RATE_LIMIT,
    usage:
      'POST JSON with Authorization: Bearer $BOTS_INGEST_SECRET. Event: { botId or botName, type: "status"|"result"|"error", title, body, links?, metadata?, timestamp?, idempotencyKey?, dispatchId? }. Legacy heartbeat (botId, status, summary, …) is still accepted. Unknown fields are rejected. Optional header: Idempotency-Key.',
  });
});
