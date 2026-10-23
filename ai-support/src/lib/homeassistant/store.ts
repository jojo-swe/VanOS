import { sampleHaSnapshot } from "@/lib/demo/sample";
import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { bestEffortWrite } from "@/lib/durable/respond";
import { isDemoMode } from "@/lib/security/config";
import { isHaConfigured } from "./config";
import { haCallService, haGetStates, haPing } from "./client";
import type {
  HaCallRecord,
  HaServiceCall,
  HaSnapshot,
} from "./types";

const KEY = "ha-state";
const MAX_CALLS = 40;

interface HaStore {
  updatedAt: string;
  recentCalls: HaCallRecord[];
}

function empty(): HaStore {
  return { updatedAt: new Date().toISOString(), recentCalls: [] };
}

async function load(): Promise<HaStore> {
  return normalize(await durableGetJson<HaStore>(KEY));
}

function normalize(disk: HaStore | null): HaStore {
  if (!disk || !Array.isArray(disk.recentCalls)) return empty();
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    recentCalls: disk.recentCalls ?? [],
  };
}

function newId() {
  return `ha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function recordHaCall(
  partial: Omit<HaCallRecord, "id" | "at"> & { id?: string; at?: string },
): Promise<HaCallRecord> {
  const row: HaCallRecord = {
    id: partial.id ?? newId(),
    at: partial.at ?? new Date().toISOString(),
    domain: partial.domain,
    service: partial.service,
    entityId: partial.entityId,
    ok: partial.ok,
    error: partial.error,
    reportedBy: partial.reportedBy,
  };
  // The call already happened; failing to log it must not hide the result.
  await bestEffortWrite("ha_call_log", () =>
    durableUpdateJson<HaStore>(KEY, (disk) => {
      const state = normalize(disk);
      state.recentCalls = [row, ...state.recentCalls].slice(0, MAX_CALLS);
      state.updatedAt = new Date().toISOString();
      return state;
    }),
  );
  return row;
}

export async function getHaSnapshot(): Promise<HaSnapshot> {
  if (isDemoMode()) return sampleHaSnapshot();
  const store = await load();
  if (!isHaConfigured()) {
    return {
      updatedAt: new Date().toISOString(),
      configured: false,
      reachable: false,
      entities: [],
      recentCalls: store.recentCalls,
      status: "idle",
      detail:
        "Set HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN (Tailscale URL recommended)",
    };
  }

  const ping = await haPing();
  if (!ping.ok) {
    return {
      updatedAt: new Date().toISOString(),
      configured: true,
      reachable: false,
      baseUrl: process.env.HOME_ASSISTANT_URL || process.env.HA_URL,
      entities: [],
      recentCalls: store.recentCalls,
      status: "error",
      detail: ping.detail,
    };
  }

  const states = await haGetStates();
  return {
    updatedAt: new Date().toISOString(),
    configured: true,
    reachable: true,
    baseUrl: process.env.HOME_ASSISTANT_URL || process.env.HA_URL,
    version: ping.version,
    locationName: ping.locationName,
    entities: states.entities,
    recentCalls: store.recentCalls,
    status: "ok",
    detail: `${ping.detail} · ${states.detail}`,
  };
}

export async function runHaService(
  call: HaServiceCall,
  reportedBy?: string,
): Promise<{ snapshot: HaSnapshot; call: HaCallRecord }> {
  if (isDemoMode()) {
    return {
      snapshot: await getHaSnapshot(),
      call: {
        id: "demo",
        at: new Date().toISOString(),
        domain: call.domain,
        service: call.service,
        entityId: call.entityId,
        ok: false,
        error: "Demo mode is read-only",
        reportedBy,
      },
    };
  }
  const result = await haCallService(call);
  const record = await recordHaCall({
    domain: call.domain,
    service: call.service,
    entityId: call.entityId,
    ok: result.ok,
    error: result.ok ? undefined : result.detail,
    reportedBy,
  });
  const snapshot = await getHaSnapshot();
  return { snapshot, call: record };
}
