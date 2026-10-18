import { timedFetch } from "@/lib/integrations/http";
import { getSlackNotifyLevel, slackNotificationsEnabled } from "./config";
import { clip, slackToPlain, tsToIso } from "./format";
import type { SlackChannelResult, SlackIntegrationSnapshot, SlackMessage } from "./types";

const API = "https://slack.com/api";
const HOSTS = ["slack.com"];
const TIMEOUT_MS = 8_000;
const MESSAGES_PER_CHANNEL = 10;
const MAX_USER_LOOKUPS = 20;

type SlackJson = { ok?: boolean; error?: string } & Record<string, unknown>;

/** Readable text for the Slack error codes people actually hit. */
function explain(code: string): string {
  switch (code) {
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "account_inactive":
      return "Slack rejected SLACK_BOT_TOKEN. Create a new bot token.";
    case "missing_scope":
      return "The bot token is missing a scope. It needs channels:history, channels:read, groups:history, groups:read (and users:read for names).";
    case "not_in_channel":
      return "The bot is not in this channel. Invite it with /invite @your-bot.";
    case "channel_not_found":
      return "Channel not found. Check the id, and invite the bot if the channel is private.";
    case "ratelimited":
      return "Slack rate limited the request. It will retry on the next refresh.";
    default:
      return `Slack error: ${code.slice(0, 60)}`;
  }
}

async function slackGet(
  method: string,
  params: Record<string, string>,
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; json: SlackJson } | { ok: false; error: string }> {
  const query = new URLSearchParams(params).toString();
  const res = await timedFetch(
    `${API}/${method}${query ? `?${query}` : ""}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: TIMEOUT_MS,
      secrets: [token],
      allowHosts: HOSTS,
    },
    fetchImpl,
  );
  if (res.status === 429) return { ok: false, error: explain("ratelimited") };
  const json = (res.json ?? {}) as SlackJson;
  if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status || "error"}: ${res.text.slice(0, 80)}` };
  if (json.ok !== true) return { ok: false, error: explain(String(json.error ?? "unknown_error")) };
  return { ok: true, json };
}

interface RawMessage {
  ts?: unknown;
  user?: unknown;
  bot_id?: unknown;
  username?: unknown;
  text?: unknown;
  subtype?: unknown;
  reply_count?: unknown;
  bot_profile?: { name?: unknown };
}

/** Message types that are noise in a status panel. */
const SKIP_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose"]);

export async function loadSlackChannels(
  token: string,
  channelIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<SlackIntegrationSnapshot> {
  const base = {
    updatedAt: new Date().toISOString(),
    configured: true,
    notifications: slackNotificationsEnabled(),
    notifyLevel: getSlackNotifyLevel(),
    cached: false,
  };

  const auth = await slackGet("auth.test", {}, token, fetchImpl);
  if (!auth.ok) {
    return { ...base, status: "error", detail: auth.error, channels: [] };
  }
  const workspaceUrl =
    typeof auth.json.url === "string" && /^https:\/\/[a-z0-9.-]+\.slack\.com\/?$/i.test(auth.json.url)
      ? auth.json.url
      : "";
  const workspace = typeof auth.json.team === "string" ? auth.json.team : undefined;

  const rawByChannel = await Promise.all(
    channelIds.map(async (id) => {
      const [info, history] = await Promise.all([
        slackGet("conversations.info", { channel: id }, token, fetchImpl),
        slackGet("conversations.history", { channel: id, limit: String(MESSAGES_PER_CHANNEL) }, token, fetchImpl),
      ]);
      const channel = info.ok ? (info.json.channel as { name?: unknown } | undefined) : undefined;
      const name = typeof channel?.name === "string" ? channel.name : id;
      if (!history.ok) return { id, name, error: history.error, raw: [] as RawMessage[] };
      const raw = Array.isArray(history.json.messages) ? (history.json.messages as RawMessage[]) : [];
      return { id, name, raw: raw.filter((m) => !SKIP_SUBTYPES.has(String(m.subtype ?? ""))) };
    }),
  );

  // Resolve a few user ids to names. Without users:read this quietly keeps ids.
  const userIds = [
    ...new Set(
      rawByChannel.flatMap((c) =>
        c.raw.map((m) => (typeof m.user === "string" ? m.user : "")).filter(Boolean),
      ),
    ),
  ].slice(0, MAX_USER_LOOKUPS);
  const names: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (user) => {
      const res = await slackGet("users.info", { user }, token, fetchImpl);
      if (!res.ok) return;
      const u = res.json.user as
        | { name?: unknown; real_name?: unknown; profile?: { display_name?: unknown; real_name?: unknown } }
        | undefined;
      const pick = [u?.profile?.display_name, u?.profile?.real_name, u?.real_name, u?.name].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (pick) names[user] = pick.trim();
    }),
  );

  const channels: SlackChannelResult[] = rawByChannel.map((c) => {
    const messages: SlackMessage[] = c.raw
      .filter((m) => typeof m.ts === "string")
      .map((m) => {
        const ts = m.ts as string;
        const user = typeof m.user === "string" ? m.user : "";
        const botName = typeof m.bot_profile?.name === "string" ? m.bot_profile.name : undefined;
        const author =
          (user && names[user]) ||
          (typeof m.username === "string" ? m.username : undefined) ||
          botName ||
          user ||
          (typeof m.bot_id === "string" ? m.bot_id : "unknown");
        return {
          ts,
          author,
          text: clip(slackToPlain(typeof m.text === "string" ? m.text : "", names), 400),
          at: tsToIso(ts),
          replies: typeof m.reply_count === "number" ? m.reply_count : 0,
          url: workspaceUrl ? `${workspaceUrl.replace(/\/+$/, "")}/archives/${c.id}/p${ts.replace(".", "")}` : undefined,
        };
      });
    return c.error ? { id: c.id, name: c.name, messages, error: c.error } : { id: c.id, name: c.name, messages };
  });

  const failed = channels.filter((c) => c.error).length;
  const total = channels.reduce((n, c) => n + c.messages.length, 0);
  return {
    ...base,
    workspace,
    channels,
    status: failed === channels.length ? "error" : failed ? "warn" : "ok",
    detail: failed
      ? `${channels.length - failed} of ${channels.length} channels loaded`
      : `${total} recent messages from ${channels.length} channel${channels.length === 1 ? "" : "s"}`,
  };
}
