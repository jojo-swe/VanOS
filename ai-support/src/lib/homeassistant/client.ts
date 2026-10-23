import {
  getHaBaseUrl,
  getHaToken,
  getHaWatchEntities,
  isHaServiceAllowed,
} from "./config";
import type { HaEntityState, HaServiceCall } from "./types";

async function haFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const base = getHaBaseUrl();
  const token = getHaToken();
  if (!base || !token) {
    return {
      ok: false,
      status: 503,
      json: null,
      text: "Home Assistant not configured",
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

export async function haPing(): Promise<{
  ok: boolean;
  version?: string;
  locationName?: string;
  detail: string;
}> {
  const res = await haFetch("/api/");
  if (!res.ok) {
    return {
      ok: false,
      detail: `HA ${res.status}: ${res.text.slice(0, 120) || "unreachable"}`,
    };
  }
  const body = (res.json ?? {}) as {
    message?: string;
    version?: string;
    location_name?: string;
  };
  return {
    ok: true,
    version: body.version,
    locationName: body.location_name,
    detail: body.message || "API running",
  };
}

function mapState(raw: Record<string, unknown>): HaEntityState {
  const entityId = String(raw.entity_id ?? "");
  const attrs = (raw.attributes ?? {}) as Record<string, unknown>;
  const slim: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      if (
        [
          "friendly_name",
          "unit_of_measurement",
          "device_class",
          "icon",
          "battery",
        ].includes(k) ||
        Object.keys(slim).length < 6
      ) {
        slim[k] = v;
      }
    }
  }
  return {
    entityId,
    state: String(raw.state ?? "unknown"),
    friendlyName:
      typeof attrs.friendly_name === "string"
        ? attrs.friendly_name
        : undefined,
    domain: entityId.includes(".") ? entityId.split(".")[0] : undefined,
    unit:
      typeof attrs.unit_of_measurement === "string"
        ? attrs.unit_of_measurement
        : undefined,
    lastChanged:
      typeof raw.last_changed === "string" ? raw.last_changed : undefined,
    attrs: slim,
  };
}

export async function haGetStates(
  entityIds?: string[],
): Promise<{ ok: boolean; entities: HaEntityState[]; detail: string }> {
  const watch = entityIds?.length ? entityIds : getHaWatchEntities();
  if (!watch.length) {
    const res = await haFetch("/api/states");
    if (!res.ok) {
      return {
        ok: false,
        entities: [],
        detail: `HA states ${res.status}`,
      };
    }
    const list = Array.isArray(res.json) ? res.json : [];
    const entities = list
      .slice(0, 40)
      .map((row) => mapState(row as Record<string, unknown>));
    return { ok: true, entities, detail: `${entities.length} entities` };
  }

  const entities: HaEntityState[] = [];
  const errors: string[] = [];
  for (const id of watch.slice(0, 40)) {
    const res = await haFetch(`/api/states/${encodeURIComponent(id)}`);
    if (!res.ok) {
      errors.push(id);
      continue;
    }
    entities.push(mapState((res.json ?? {}) as Record<string, unknown>));
  }
  return {
    ok: entities.length > 0 || errors.length === 0,
    entities,
    detail: errors.length
      ? `Loaded ${entities.length}; missing ${errors.join(", ")}`
      : `${entities.length} watched entities`,
  };
}

export async function haCallService(
  call: HaServiceCall,
): Promise<{ ok: boolean; status: number; detail: string; result?: unknown }> {
  const domain = call.domain?.trim();
  const service = call.service?.trim();
  if (!domain || !service) {
    return { ok: false, status: 400, detail: "domain and service required" };
  }
  if (!isHaServiceAllowed(domain, service)) {
    return {
      ok: false,
      status: 403,
      detail: `${domain}.${service} is not in HA_ALLOWED_SERVICES`,
    };
  }

  const body: Record<string, unknown> = { ...(call.data ?? {}) };
  if (call.entityId) {
    body.entity_id = call.entityId;
  }
  if (call.target) {
    body.target = call.target;
  }

  const res = await haFetch(
    `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return {
    ok: res.ok,
    status: res.status,
    detail: res.ok
      ? `Called ${domain}.${service}`
      : `HA ${res.status}: ${res.text.slice(0, 160)}`,
    result: res.json,
  };
}
