import type { HealthStatus } from "@/lib/dashboard/types";

export interface GrokBotTarget {
  id: string;
  name: string;
  role: string;
  webhookUrl: string;
  webhookKey: string;
  configured: boolean;
}

export interface BotAlertIngest {
  severity: HealthStatus;
  title: string;
  body: string;
}

/** Event report posted by a Grok Bot. Heartbeats may omit this. */
export type BotEventType = "status" | "result" | "error";

export interface BotLink {
  url: string;
  label?: string;
}

export interface BotIngestPayload {
  /** Matches a configured target id (e.g. muddy) or any custom id */
  botId: string;
  botName?: string;
  /**
   * Event kind. When set, title and body are required.
   * Legacy heartbeats omit this and send status/summary instead.
   */
  type?: BotEventType;
  title?: string;
  /** Event body, or legacy alert/summary text when type is set (copied to summary). */
  body?: string;
  links?: BotLink[];
  /** Shallow JSON: string, number, boolean, or null values. */
  metadata?: Record<string, string | number | boolean | null>;
  /** Client event time (ISO-8601). Server receipt is receivedAt. */
  timestamp?: string;
  /** Replay of the same botId + key returns the original event. */
  idempotencyKey?: string;
  status?: HealthStatus;
  focus?: string;
  summary?: string;
  alerts?: BotAlertIngest[];
  metrics?: Record<string, string | number>;
  /** Optional correlation to a prior dispatch */
  dispatchId?: string;
  /** Free-form extras from a legacy heartbeat */
  data?: Record<string, unknown>;
}

export interface BotIngestEvent extends BotIngestPayload {
  id: string;
  receivedAt: string;
}

export interface BotDispatchRecord {
  id: string;
  botId: string;
  botName: string;
  task: string;
  context?: Record<string, unknown>;
  createdAt: string;
  /** HTTP status from Grok Bot webhook, if known */
  webhookStatus?: number;
  accepted: boolean;
  error?: string;
}

export interface BotBridgeState {
  updatedAt: string;
  events: BotIngestEvent[];
  dispatches: BotDispatchRecord[];
  /** Latest status per botId */
  latestByBot: Record<string, BotIngestEvent>;
  /** `${botId}:${idempotencyKey}` → event id */
  idempotency?: Record<string, string>;
}

export interface BotBridgeStatusResponse {
  targets: Array<Omit<GrokBotTarget, "webhookKey" | "webhookUrl"> & { hasKey: boolean }>;
  ingestConfigured: boolean;
  ingestUrlPath: string;
  state: BotBridgeState;
  setup: {
    routinePrompt: string;
    ingestExample: string;
  };
}
