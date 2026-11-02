import type { HealthStatus } from "@/lib/dashboard/types";

export interface SlackMessage {
  ts: string;
  /** Display name when users:read allows it, otherwise the user or bot id. */
  author: string;
  /** Plain text with Slack markup turned into readable text. Never HTML. */
  text: string;
  at: string;
  replies: number;
  url?: string;
}

export interface SlackChannelResult {
  id: string;
  name: string;
  messages: SlackMessage[];
  error?: string;
}

export interface SlackIntegrationSnapshot {
  updatedAt: string;
  configured: boolean;
  status: HealthStatus;
  detail: string;
  workspace?: string;
  channels: SlackChannelResult[];
  /** Incoming-webhook notifications are configured (the URL itself is never returned). */
  notifications: boolean;
  notifyLevel: SlackNotifyLevel;
  cached: boolean;
}

export type SlackNotifyLevel = "errors" | "all" | "off";

export interface SlackNotice {
  severity: HealthStatus;
  title: string;
  body?: string;
  /** Short origin label, e.g. the bot name. */
  source?: string;
  /** Same key within the dedupe window is sent once. */
  dedupeKey?: string;
}
