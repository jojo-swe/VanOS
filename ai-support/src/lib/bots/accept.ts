import {
  BOT_INGEST_RATE_LIMIT,
  BOT_INGEST_RATE_WINDOW_MS,
  MAX_INGEST_BYTES,
  parseBotIngest,
  plainRecord,
} from "./parse-ingest";
import { persistIngest } from "./store";
import type { BotIngestEvent } from "./types";
import { rateLimitConsume } from "@/lib/security/rate-limit";
import { noticeForBotEvent, notifyInBackground } from "@/lib/slack/notify";

export type BotAcceptResult =
  | { ok: true; event: BotIngestEvent; idempotent: boolean; remaining: number }
  | {
      ok: false;
      status: 400 | 413 | 429;
      body: Record<string, unknown>;
      headers?: Record<string, string>;
    };

/**
 * The one way a bot event gets stored: size cap, strict schema (unknown
 * fields rejected), per-bot rate limit, then an idempotent write. Used by
 * /api/bots/ingest, /api/v1/ingest (domain "bots") and /api/v1/sync.
 */
export async function acceptBotIngest(
  raw: Record<string, unknown>,
  opts?: { idempotencyKeyHeader?: string | null },
): Promise<BotAcceptResult> {
  const size = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
  if (size > MAX_INGEST_BYTES) {
    return {
      ok: false,
      status: 413,
      body: {
        error: `Payload too large (max ${MAX_INGEST_BYTES} bytes)`,
        maxBytes: MAX_INGEST_BYTES,
      },
    };
  }

  const parsed = parseBotIngest(plainRecord(raw), opts);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      body: parsed.fields ? { error: parsed.error, fields: parsed.fields } : { error: parsed.error },
    };
  }

  const rl = await rateLimitConsume(
    `bots:ingest:${parsed.payload.botId}`,
    BOT_INGEST_RATE_LIMIT,
    BOT_INGEST_RATE_WINDOW_MS,
  );
  if (!rl.ok) {
    return {
      ok: false,
      status: 429,
      body: { error: "Rate limit exceeded for this bot", botId: parsed.payload.botId },
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        "X-RateLimit-Remaining": "0",
      },
    };
  }

  const { event, idempotent } = await persistIngest(parsed.payload);
  // A replayed idempotency key is the same event; do not notify twice.
  if (!idempotent) notifyInBackground(noticeForBotEvent(event));
  return { ok: true, event, idempotent, remaining: rl.remaining };
}
