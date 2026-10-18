import type { AccessMode } from "@/lib/security/config";

export type SyncSource = "n8n" | "grok" | "openclaw" | "hermes" | "manual" | "cron";

export type SyncDomain = "bots" | "costs" | "money" | "connections" | "board";

export interface SyncDigestPayload {
  source: SyncSource;
  /** ISO date for the digest day (UTC). Defaults to today. */
  date?: string;
  summary?: string;
  period?: "daily" | "hourly" | "manual";
  /** Optional nested domain payloads applied via ingest helpers */
  domains?: Partial<Record<SyncDomain, Record<string, unknown>>>;
  reportedBy?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface SyncDigestRecord {
  id: string;
  receivedAt: string;
  source: SyncSource;
  date: string;
  period: "daily" | "hourly" | "manual";
  summary?: string;
  reportedBy?: string;
  domainsApplied: SyncDomain[];
  domainErrors?: Partial<Record<SyncDomain, string>>;
  meta?: Record<string, string | number | boolean>;
}

export interface SyncState {
  updatedAt: string;
  digests: SyncDigestRecord[];
  lastBySource: Partial<Record<SyncSource, SyncDigestRecord>>;
  lastDaily?: SyncDigestRecord;
}

export interface SetupCheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "ok" | "warn" | "error" | "idle";
}

export interface SetupStatus {
  updatedAt: string;
  agentApiConfigured: boolean;
  ingestConfigured: boolean;
  durableBackend: "memory+file" | "upstash";
  durableOk: boolean;
  durableDetail: string;
  grokBotsConfigured: number;
  grokBotsTotal: number;
  dashboardAuthConfigured: boolean;
  accessMode: AccessMode;
  security: {
    mode: AccessMode;
    basicAuthConfigured: boolean;
    requireBasicAuth: boolean;
    requireNetworkGate: boolean;
    publicIngest: boolean;
    trustTailscaleCgnat: boolean;
    edgeSecretConfigured: boolean;
    allowedTailscaleUsers: number;
    allowedHosts: number;
    privateAppUrl: string | null;
    publicIngestUrl: string | null;
  };
  lastDigest?: {
    id: string;
    source: SyncSource;
    receivedAt: string;
    date: string;
    summary?: string;
  };
  lastGrokIngestAt?: string | null;
  hoursSinceLastDigest: number | null;
  hoursSinceLastGrokIngest: number | null;
  checks: SetupCheckItem[];
  endpoints: {
    digest: string;
    snapshot: string;
    health: string;
    setup: string;
  };
  cronHint: string;
}
