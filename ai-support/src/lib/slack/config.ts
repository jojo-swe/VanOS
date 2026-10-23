import type { SlackNotifyLevel } from "./types";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** Bot token (xoxb-…) for the read-only panel. */
export function getSlackToken(): string | undefined {
  return env("SLACK_BOT_TOKEN");
}

const CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;

/** Public (C…) or private (G…) channel ids to show, at most 10. */
export function getSlackChannelIds(): string[] {
  const raw = env("SLACK_CHANNEL_IDS");
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const id = part.trim().toUpperCase();
    if (CHANNEL_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 10);
}

export function isSlackConfigured(): boolean {
  return Boolean(getSlackToken() && getSlackChannelIds().length);
}

export function slackDisabledDetail(): string | null {
  const token = getSlackToken();
  const raw = env("SLACK_CHANNEL_IDS");
  if (!token && !raw) return null;
  if (!token) return "The Slack panel is off until SLACK_BOT_TOKEN is set.";
  if (!raw) return "Set SLACK_CHANNEL_IDS to the channels to show (comma-separated ids like C0123ABCD).";
  if (!getSlackChannelIds().length) {
    return "SLACK_CHANNEL_IDS has no valid channel id. Use ids like C0123ABCD, not #names.";
  }
  return null;
}

/**
 * Incoming-webhook URL for notifications. Only https://hooks.slack.com
 * /services/… or /triggers/… is accepted, so a bad value cannot send
 * Mission Control alerts anywhere else.
 */
export function getSlackWebhookUrl(): string | undefined {
  const raw = env("SLACK_WEBHOOK_URL");
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com") return undefined;
    if (url.username || url.password) return undefined;
    if (!/^\/(services|triggers)\//.test(url.pathname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** True when SLACK_WEBHOOK_URL is set but not a Slack incoming-webhook URL. */
export function slackWebhookInvalid(): boolean {
  return Boolean(env("SLACK_WEBHOOK_URL")) && !getSlackWebhookUrl();
}

/** errors (default): failures only. all: also finished results. off: nothing. */
export function getSlackNotifyLevel(): SlackNotifyLevel {
  const raw = env("SLACK_NOTIFY")?.toLowerCase();
  if (raw === "all" || raw === "off") return raw;
  return "errors";
}

export function slackNotificationsEnabled(): boolean {
  return Boolean(getSlackWebhookUrl()) && getSlackNotifyLevel() !== "off";
}
