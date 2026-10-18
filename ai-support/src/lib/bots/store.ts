import { sampleBridgeState } from "@/lib/demo/sample";
import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { bestEffortWrite } from "@/lib/durable/respond";
import { isDemoMode } from "@/lib/security/config";
import type {
  BotBridgeState,
  BotDispatchRecord,
  BotIngestEvent,
  BotIngestPayload,
} from "./types";

const KEY = "bridge-state";
const MAX_EVENTS = 100;
const MAX_DISPATCHES = 50;
const MAX_IDEMPOTENCY = 200;
/** Distinct bots kept in latestByBot; the least recently heard from are dropped. */
const MAX_BOTS = 100;

function emptyState(): BotBridgeState {
  return {
    updatedAt: new Date().toISOString(),
    events: [],
    dispatches: [],
    latestByBot: {},
  };
}

function normalize(disk: BotBridgeState | null): BotBridgeState {
  if (!disk || !Array.isArray(disk.events)) return emptyState();
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    events: disk.events ?? [],
    dispatches: disk.dispatches ?? [],
    latestByBot: disk.latestByBot ?? {},
    idempotency: disk.idempotency ?? {},
  };
}

export async function getBridgeState(): Promise<BotBridgeState> {
  if (isDemoMode()) return sampleBridgeState();
  return normalize(await durableGetJson<BotBridgeState>(KEY));
}

/** Atomically change the bridge state. `mutate` may run more than once. */
async function update(mutate: (state: BotBridgeState) => boolean | void): Promise<void> {
  await durableUpdateJson<BotBridgeState>(KEY, (disk) => {
    const state = normalize(disk);
    if (mutate(state) === false) return null;
    state.updatedAt = new Date().toISOString();
    return state;
  });
}

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function rememberIdempotency(
  state: BotBridgeState,
  botId: string,
  key: string,
  eventId: string,
) {
  const map = state.idempotency ?? {};
  const mapKey = `${botId}:${key}`;
  delete map[mapKey];
  map[mapKey] = eventId;
  const keys = Object.keys(map);
  if (keys.length > MAX_IDEMPOTENCY) {
    for (const old of keys.slice(0, keys.length - MAX_IDEMPOTENCY)) {
      delete map[old];
    }
  }
  state.idempotency = map;
}

function findIdempotent(
  state: BotBridgeState,
  botId: string,
  key: string,
): BotIngestEvent | undefined {
  const mapKey = `${botId}:${key}`;
  const existingId = state.idempotency?.[mapKey];
  if (existingId) {
    const byId = state.events.find((e) => e.id === existingId);
    if (byId) return byId;
  }
  return state.events.find(
    (e) => e.botId === botId && e.idempotencyKey === key,
  );
}

/**
 * Store an ingest. A repeated idempotency key for the same bot returns the
 * original event and does not append another row.
 */
export async function persistIngest(
  payload: BotIngestPayload,
): Promise<{ event: BotIngestEvent; idempotent: boolean }> {
  if (isDemoMode()) {
    return {
      idempotent: false,
      event: {
        ...payload,
        id: "demo",
        receivedAt: new Date().toISOString(),
      },
    };
  }
  const fresh: BotIngestEvent = {
    ...payload,
    id: newId("evt"),
    receivedAt: new Date().toISOString(),
  };
  let result: { event: BotIngestEvent; idempotent: boolean } = {
    event: fresh,
    idempotent: false,
  };
  await update((state) => {
    if (payload.idempotencyKey) {
      const existing = findIdempotent(state, payload.botId, payload.idempotencyKey);
      if (existing) {
        result = { event: existing, idempotent: true };
        const mapKey = `${payload.botId}:${payload.idempotencyKey}`;
        if (state.idempotency?.[mapKey] === existing.id) return false;
        rememberIdempotency(state, payload.botId, payload.idempotencyKey, existing.id);
        return;
      }
    }
    result = { event: fresh, idempotent: false };
    state.events = [fresh, ...state.events].slice(0, MAX_EVENTS);
    delete state.latestByBot[fresh.botId];
    state.latestByBot[fresh.botId] = fresh;
    const bots = Object.keys(state.latestByBot);
    for (const old of bots.slice(0, Math.max(0, bots.length - MAX_BOTS))) {
      delete state.latestByBot[old];
    }
    if (payload.idempotencyKey) {
      rememberIdempotency(state, payload.botId, payload.idempotencyKey, fresh.id);
    }
  });
  return result;
}

export async function recordIngest(
  payload: BotIngestPayload,
): Promise<BotIngestEvent> {
  const saved = await persistIngest(payload);
  return saved.event;
}

export async function recordDispatch(
  record: Omit<BotDispatchRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  },
): Promise<BotDispatchRecord> {
  const full: BotDispatchRecord = {
    id: record.id ?? newId("dsp"),
    createdAt: record.createdAt ?? new Date().toISOString(),
    botId: record.botId,
    botName: record.botName,
    task: record.task,
    context: record.context,
    webhookStatus: record.webhookStatus,
    accepted: record.accepted,
    error: record.error,
  };
  // The webhook has already been called; failing to log it must not hide that.
  await bestEffortWrite("dispatch_log", () =>
    update((state) => {
      state.dispatches = [full, ...state.dispatches].slice(0, MAX_DISPATCHES);
    }),
  );
  return full;
}
