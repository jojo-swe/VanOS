import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import type { SyncDigestRecord, SyncSource, SyncState } from "./types";

const KEY = "sync-state";
const MAX_DIGESTS = 60;

function emptyState(): SyncState {
  return {
    updatedAt: new Date().toISOString(),
    digests: [],
    lastBySource: {},
  };
}

export async function getSyncState(): Promise<SyncState> {
  return normalize(await durableGetJson<SyncState>(KEY));
}

function normalize(disk: SyncState | null): SyncState {
  if (!disk || !Array.isArray(disk.digests)) return emptyState();
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    digests: disk.digests ?? [],
    lastBySource: disk.lastBySource ?? {},
    lastDaily: disk.lastDaily,
  };
}

function newId() {
  return `dig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordDigest(
  record: Omit<SyncDigestRecord, "id" | "receivedAt"> & {
    id?: string;
    receivedAt?: string;
  },
): Promise<SyncDigestRecord> {
  const full: SyncDigestRecord = {
    id: record.id ?? newId(),
    receivedAt: record.receivedAt ?? new Date().toISOString(),
    source: record.source,
    date: record.date,
    period: record.period,
    summary: record.summary,
    reportedBy: record.reportedBy,
    domainsApplied: record.domainsApplied,
    domainErrors: record.domainErrors,
    meta: record.meta,
  };

  await durableUpdateJson<SyncState>(KEY, (disk) => {
    const state = normalize(disk);
    state.digests = [full, ...state.digests].slice(0, MAX_DIGESTS);
    state.lastBySource[full.source] = full;
    if (full.period === "daily") state.lastDaily = full;
    state.updatedAt = new Date().toISOString();
    return state;
  });
  return full;
}

export function hoursSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

export function isSyncSource(v: unknown): v is SyncSource {
  return (
    v === "n8n" ||
    v === "grok" ||
    v === "openclaw" ||
    v === "hermes" ||
    v === "manual" ||
    v === "cron"
  );
}
