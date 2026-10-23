import { getGrokBotTargets, getIngestSecret } from "./config";
import { recordDispatch } from "./store";
import type { BotDispatchRecord } from "./types";
import { getPublicIngestBaseUrl } from "@/lib/security/config";
import { noticeForDispatch, notifyInBackground } from "@/lib/slack/notify";

export const MAX_TASK_CHARS = 4_000;
export const MAX_CONTEXT_BYTES = 8_192;
const WEBHOOK_TIMEOUT_MS = 15_000;

export type DispatchResult =
  | { kind: "rejected"; status: 400 | 404 | 503; error: string }
  | { kind: "sent"; accepted: boolean; record: BotDispatchRecord; error?: string };

/**
 * Where a bot posts its result. /api/bots/ingest with BOTS_INGEST_SECRET is
 * open on every deployment shape, including the edge host, so the callback
 * always works and the bot never needs the broader agent token.
 */
export function dispatchCallbackUrl(requestOrigin: string): string {
  const base = (getPublicIngestBaseUrl() || requestOrigin).replace(/\/+$/, "");
  return `${base}/api/bots/ingest`;
}

/**
 * Send a task to one configured Grok Bot and record the dispatch. Shared by
 * /api/bots/dispatch (dashboard), /api/v1/dispatch (agents) and the MCP
 * `vanos_create_dispatch` tool, so all three validate and call back the
 * same way.
 */
export async function dispatchToBot(
  input: { botId?: unknown; task?: unknown; context?: unknown },
  opts: { origin: string; source: string },
): Promise<DispatchResult> {
  const botId = typeof input.botId === "string" ? input.botId.trim() : "";
  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (!botId || !task) return { kind: "rejected", status: 400, error: "botId and task are required" };
  if (task.length > MAX_TASK_CHARS) {
    return { kind: "rejected", status: 400, error: `task must be at most ${MAX_TASK_CHARS} characters` };
  }

  let context: Record<string, unknown> | undefined;
  if (input.context !== undefined && input.context !== null) {
    if (typeof input.context !== "object" || Array.isArray(input.context)) {
      return { kind: "rejected", status: 400, error: "context must be a JSON object" };
    }
    context = input.context as Record<string, unknown>;
    const bytes = new TextEncoder().encode(JSON.stringify(context)).byteLength;
    if (bytes > MAX_CONTEXT_BYTES) {
      return { kind: "rejected", status: 400, error: `context must be at most ${MAX_CONTEXT_BYTES} bytes` };
    }
  }

  const target = getGrokBotTargets().find((t) => t.id === botId);
  if (!target) return { kind: "rejected", status: 404, error: `Unknown botId: ${botId}` };
  if (!target.configured) {
    return {
      kind: "rejected",
      status: 503,
      error: `Bot "${botId}" has no webhook configured. Set GROK_BOT_${botId.toUpperCase()}_WEBHOOK_URL and _KEY (or GROK_BOT_DEFAULT_WEBHOOK_*).`,
    };
  }

  const dispatchId = `dsp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const webhookBody = {
    source: opts.source,
    botId: target.id,
    botName: target.name,
    dispatchId,
    task,
    context: context ?? {},
    callback: {
      url: dispatchCallbackUrl(opts.origin),
      method: "POST",
      auth: "Authorization: Bearer <BOTS_INGEST_SECRET>",
      ingestConfigured: Boolean(getIngestSecret()),
      exampleBody: {
        botId: target.id,
        botName: target.name,
        dispatchId,
        status: "ok",
        focus: "short status line",
        summary: "What you finished",
        alerts: [{ severity: "warn", title: "Optional", body: "Detail" }],
      },
    },
    instruction:
      "Complete the task from Mission Control. When finished, POST a status JSON to callback.url using the ingest secret as Bearer token.",
  };

  let webhookStatus: number | undefined;
  let accepted = false;
  let error: string | undefined;
  try {
    const res = await fetch(target.webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.webhookKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookBody),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    webhookStatus = res.status;
    accepted = res.status === 200;
    if (!accepted) {
      const text = await res.text().catch(() => "");
      error = text.slice(0, 400) || `Webhook returned ${res.status}`;
    }
  } catch (e) {
    error =
      e instanceof Error && e.name === "TimeoutError"
        ? `Webhook did not answer within ${WEBHOOK_TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : "Webhook request failed";
  }

  const record = await recordDispatch({
    id: dispatchId,
    botId: target.id,
    botName: target.name,
    task,
    context,
    webhookStatus,
    accepted,
    error,
  });
  notifyInBackground(noticeForDispatch(record));
  return { kind: "sent", accepted, record, error };
}
