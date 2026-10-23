import { timedFetch } from "@/lib/integrations/http";
import { isDemoMode } from "@/lib/security/config";
import type { BotDispatchRecord, BotIngestEvent } from "@/lib/bots/types";
import { getSlackNotifyLevel, getSlackWebhookUrl, slackNotificationsEnabled } from "./config";
import { clip, escapeSlack } from "./format";
import type { SlackNotice } from "./types";

const DEDUPE_MS = 10 * 60_000;
const MAX_PER_MINUTE = 20;
const TIMEOUT_MS = 5_000;

type NotifyState = { recent: Map<string, number>; window: number; sent: number };
type GlobalNotify = { __vanosSlackNotify?: NotifyState };

function state(): NotifyState {
  const g = globalThis as unknown as GlobalNotify;
  if (!g.__vanosSlackNotify) g.__vanosSlackNotify = { recent: new Map(), window: 0, sent: 0 };
  return g.__vanosSlackNotify;
}

export function clearSlackNotifyState(): void {
  const s = state();
  s.recent.clear();
  s.window = 0;
  s.sent = 0;
}

/** Skip a repeat of the same notice and cap the rate, so a looping bot cannot flood the channel. */
function allowed(notice: SlackNotice, now: number): boolean {
  const s = state();
  for (const [key, at] of s.recent) if (now - at > DEDUPE_MS) s.recent.delete(key);
  const key = notice.dedupeKey ?? `${notice.severity}:${notice.source ?? ""}:${notice.title}`;
  if (s.recent.has(key)) return false;
  const minute = Math.floor(now / 60_000);
  if (s.window !== minute) {
    s.window = minute;
    s.sent = 0;
  }
  if (s.sent >= MAX_PER_MINUTE) return false;
  s.sent += 1;
  s.recent.set(key, now);
  return true;
}

const ICON: Record<SlackNotice["severity"], string> = {
  error: ":red_circle:",
  warn: ":large_yellow_circle:",
  ok: ":large_green_circle:",
  idle: ":white_circle:",
};

/** Slack payload. Every piece of bot-supplied text is escaped. */
export function slackPayload(notice: SlackNotice): { text: string } {
  const title = escapeSlack(clip(notice.title, 150));
  const source = notice.source ? ` · ${escapeSlack(clip(notice.source, 60))}` : "";
  const body = notice.body ? `\n${escapeSlack(clip(notice.body, 600))}` : "";
  return { text: `${ICON[notice.severity]} *${title}*${source}${body}` };
}

/**
 * Post one notice to SLACK_WEBHOOK_URL. Never throws and never blocks the
 * caller for long: a slow or failing Slack must not break ingest or
 * dispatch. Returns whether Slack accepted it.
 */
export async function notifySlack(
  notice: SlackNotice,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<boolean> {
  try {
    if (isDemoMode() || !slackNotificationsEnabled()) return false;
    const url = getSlackWebhookUrl();
    if (!url || !allowed(notice, now)) return false;
    const res = await timedFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload(notice)),
        timeoutMs: TIMEOUT_MS,
        secrets: [url],
        allowHosts: ["hooks.slack.com"],
      },
      fetchImpl,
    );
    if (!res.ok) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "slack_notify_failed",
          status: res.status,
        }),
      );
    }
    return res.ok;
  } catch {
    return false;
  }
}

function botLabel(event: { botName?: string; botId: string }): string {
  return event.botName || event.botId;
}

/** The notice a stored bot event should raise, or null for none. */
export function noticeForBotEvent(event: BotIngestEvent): SlackNotice | null {
  const level = getSlackNotifyLevel();
  if (level === "off") return null;
  const source = botLabel(event);
  const errorAlert = event.alerts?.find((a) => a.severity === "error");

  if (event.type === "error") {
    return { severity: "error", title: event.title || "Bot reported an error", body: event.body, source, dedupeKey: `evt:${event.id}` };
  }
  if (event.status === "error" || errorAlert) {
    return {
      severity: "error",
      title: errorAlert?.title || event.summary || "Bot status is error",
      body: errorAlert?.body || event.focus,
      source,
      dedupeKey: `status:${event.botId}:${errorAlert?.title ?? event.summary ?? ""}`,
    };
  }
  if (level === "all" && event.type === "result") {
    return { severity: "ok", title: event.title || "Bot finished a task", body: event.body, source, dedupeKey: `evt:${event.id}` };
  }
  return null;
}

/** The notice a dispatch should raise: only when the bot did not accept it. */
export function noticeForDispatch(record: BotDispatchRecord): SlackNotice | null {
  if (record.accepted || getSlackNotifyLevel() === "off") return null;
  return {
    severity: "error",
    title: `Dispatch to ${record.botName || record.botId} failed`,
    body: `${record.error ?? `Webhook returned ${record.webhookStatus ?? "no response"}`}\nTask: ${record.task}`,
    source: "Mission Control",
    dedupeKey: `dispatch:${record.id}`,
  };
}

/** Fire and forget: the caller's response never waits on Slack. */
export function notifyInBackground(notice: SlackNotice | null): void {
  if (!notice) return;
  void notifySlack(notice);
}
