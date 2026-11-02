import {
  CACHE_ERROR_MS,
  CACHE_OK_MS,
  clearIntegrationCache,
  readCache,
  tokenFingerprint,
  writeCache,
} from "@/lib/integrations/cache";
import { sampleSlackSnapshot } from "@/lib/demo/sample";
import { isDemoMode } from "@/lib/security/config";
import {
  getSlackChannelIds,
  getSlackNotifyLevel,
  getSlackToken,
  slackDisabledDetail,
  slackNotificationsEnabled,
  slackWebhookInvalid,
} from "./config";
import { loadSlackChannels } from "./client";
import type { SlackIntegrationSnapshot } from "./types";

function off(detail: string, status: SlackIntegrationSnapshot["status"]): SlackIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: false,
    status,
    detail,
    channels: [],
    notifications: slackNotificationsEnabled(),
    notifyLevel: getSlackNotifyLevel(),
    cached: false,
  };
}

export function clearSlackCache(): void {
  clearIntegrationCache("slack:");
}

export async function getSlackSnapshot(fetchImpl: typeof fetch = fetch): Promise<SlackIntegrationSnapshot> {
  if (isDemoMode()) return sampleSlackSnapshot();
  const token = getSlackToken();
  const disabled = slackDisabledDetail();
  if (!token || disabled) {
    const notes = slackWebhookInvalid()
      ? " SLACK_WEBHOOK_URL is set but is not a hooks.slack.com URL, so notifications are off."
      : slackNotificationsEnabled()
        ? " Notifications are on."
        : "";
    return off(
      (disabled ?? "The Slack panel is off. Set SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS.") + notes,
      token || slackWebhookInvalid() ? "warn" : "idle",
    );
  }
  const ids = getSlackChannelIds();
  const key = `slack:${tokenFingerprint(token)}:${ids.join(",")}`;
  const hit = readCache<SlackIntegrationSnapshot>(key);
  if (hit) return { ...hit, cached: true };
  const loaded = await loadSlackChannels(token, ids, fetchImpl);
  writeCache(key, loaded, loaded.status === "error" ? CACHE_ERROR_MS : CACHE_OK_MS);
  return loaded;
}
