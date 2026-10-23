import type { HealthStatus } from "@/lib/dashboard/types";
import type {
  BotAlertIngest,
  BotEventType,
  BotIngestPayload,
  BotLink,
} from "./types";

/** Hard cap for a single ingest body (bytes). */
export const MAX_INGEST_BYTES = 32 * 1024;

/** Accepted event posts per bot per window. */
export const BOT_INGEST_RATE_LIMIT = 30;
export const BOT_INGEST_RATE_WINDOW_MS = 60_000;

const EVENT_TYPES: readonly BotEventType[] = ["status", "result", "error"];

const EVENT_FIELDS = [
  "botId",
  "bot_id",
  "botName",
  "bot_name",
  "type",
  "title",
  "body",
  "links",
  "metadata",
  "timestamp",
  "idempotencyKey",
  "idempotency_key",
  "dispatchId",
  "dispatch_id",
] as const;

const LEGACY_FIELDS = [
  "botId",
  "bot_id",
  "botName",
  "bot_name",
  "status",
  "focus",
  "summary",
  "alerts",
  "metrics",
  "dispatchId",
  "dispatch_id",
  "data",
  "idempotencyKey",
  "idempotency_key",
] as const;

const EVENT_MARKERS = [
  "type",
  "title",
  "body",
  "links",
  "metadata",
  "timestamp",
] as const;

const LEGACY_MARKERS = [
  "status",
  "focus",
  "summary",
  "alerts",
  "metrics",
  "data",
] as const;

const PUBLIC_EVENT_FIELDS =
  "botId, botName, type, title, body, links, metadata, timestamp, idempotencyKey, dispatchId";
const PUBLIC_LEGACY_FIELDS =
  "botId, botName, status, focus, summary, alerts, metrics, dispatchId, data, idempotencyKey";

const BOT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const DISPATCH_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const META_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export type ParseResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string; fields?: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Copy own keys so __proto__ from JSON.parse cannot ride along. */
export function plainRecord(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    out[key] = (value as Record<string, unknown>)[key];
  }
  return out;
}

function unknownFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const ok = new Set<string>(allowed);
  return Object.keys(raw)
    .filter((k) => !ok.has(k))
    .sort();
}

function hasAny(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
}

function isHealth(v: unknown): v is HealthStatus {
  return v === "ok" || v === "warn" || v === "error" || v === "idle";
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) return null;
  return t;
}

function rejectUnknown(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  allowedHint: string,
): ParseResult<never> | null {
  const extra = unknownFields(raw, allowed);
  if (!extra.length) return null;
  return {
    ok: false,
    error: `Unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}. Allowed: ${allowedHint}`,
    fields: extra,
  };
}

function resolveIdentity(
  raw: Record<string, unknown>,
): { botId: string; botName?: string } | { error: string } {
  const hasId = typeof raw.botId === "string" || typeof raw.bot_id === "string";
  const hasName =
    typeof raw.botName === "string" || typeof raw.bot_name === "string";

  if (raw.botId !== undefined && typeof raw.botId !== "string") {
    return { error: "botId must be a string" };
  }
  if (raw.bot_id !== undefined && typeof raw.bot_id !== "string") {
    return { error: "bot_id must be a string" };
  }
  if (
    typeof raw.botId === "string" &&
    typeof raw.bot_id === "string" &&
    raw.botId.trim() !== raw.bot_id.trim()
  ) {
    return { error: "botId and bot_id do not match" };
  }

  if (hasName) {
    const nameRaw = typeof raw.botName === "string" ? raw.botName : raw.bot_name;
    if (!cleanString(nameRaw, 80)) {
      return { error: "botName must be 1–80 characters" };
    }
  }
  if (
    typeof raw.botName === "string" &&
    typeof raw.bot_name === "string" &&
    raw.botName.trim() !== raw.bot_name.trim()
  ) {
    return { error: "botName and bot_name do not match" };
  }

  const botName = hasName
    ? cleanString(
        typeof raw.botName === "string" ? raw.botName : raw.bot_name,
        80,
      ) ?? undefined
    : undefined;

  let botId = (
    typeof raw.botId === "string"
      ? raw.botId
      : typeof raw.bot_id === "string"
        ? raw.bot_id
        : ""
  ).trim();

  if (!botId && botName) {
    botId = botName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  if (!hasId && !hasName) {
    return { error: "botId or botName is required" };
  }
  if (!botId || !BOT_ID_RE.test(botId)) {
    return {
      error:
        "botId must be 1–64 characters (letters, digits, dot, underscore, hyphen)",
    };
  }
  return { botId, botName };
}

function parseIdempotency(
  raw: Record<string, unknown>,
  header?: string | null,
): { ok: true; key?: string } | { ok: false; error: string } {
  if (
    raw.idempotencyKey !== undefined &&
    typeof raw.idempotencyKey !== "string"
  ) {
    return { ok: false, error: "idempotencyKey must be a string" };
  }
  if (
    raw.idempotency_key !== undefined &&
    typeof raw.idempotency_key !== "string"
  ) {
    return { ok: false, error: "idempotency_key must be a string" };
  }
  const fromCamel =
    typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  const fromSnake =
    typeof raw.idempotency_key === "string" ? raw.idempotency_key.trim() : "";
  if (fromCamel && fromSnake && fromCamel !== fromSnake) {
    return { ok: false, error: "idempotencyKey and idempotency_key do not match" };
  }
  const fromBody = fromCamel || fromSnake || undefined;
  const fromHeader = header?.trim() || undefined;
  if (fromBody && fromHeader && fromBody !== fromHeader) {
    return {
      ok: false,
      error: "Idempotency-Key header does not match idempotencyKey",
    };
  }
  const key = fromHeader || fromBody;
  if (!key) return { ok: true };
  if (!IDEMPOTENCY_RE.test(key)) {
    return {
      ok: false,
      error:
        "idempotencyKey must be 1–128 characters (letters, digits, . _ : -)",
    };
  }
  return { ok: true, key };
}

function parseDispatchId(
  raw: Record<string, unknown>,
): { ok: true; dispatchId?: string } | { ok: false; error: string } {
  if (raw.dispatchId !== undefined && typeof raw.dispatchId !== "string") {
    return { ok: false, error: "dispatchId must be a string" };
  }
  if (raw.dispatch_id !== undefined && typeof raw.dispatch_id !== "string") {
    return { ok: false, error: "dispatch_id must be a string" };
  }
  const a = typeof raw.dispatchId === "string" ? raw.dispatchId.trim() : "";
  const b = typeof raw.dispatch_id === "string" ? raw.dispatch_id.trim() : "";
  if (a && b && a !== b) {
    return { ok: false, error: "dispatchId and dispatch_id do not match" };
  }
  const dispatchId = a || b || undefined;
  if (!dispatchId) return { ok: true };
  if (!DISPATCH_RE.test(dispatchId)) {
    return {
      ok: false,
      error:
        "dispatchId must be 1–80 characters (letters, digits, . _ : -)",
    };
  }
  return { ok: true, dispatchId };
}

function checkUrl(v: string): string | null {
  const t = v.trim();
  if (!t || t.length > 500) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return t;
}

function parseLinks(
  raw: unknown,
): { ok: true; links?: BotLink[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw)) return { ok: false, error: "links must be an array" };
  if (raw.length > 8) return { ok: false, error: "links accepts at most 8 items" };
  const links: BotLink[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const url = checkUrl(item);
      if (!url) {
        return { ok: false, error: "links entries must be http(s) URLs" };
      }
      links.push({ url });
      continue;
    }
    if (!isPlainObject(item)) {
      return {
        ok: false,
        error: "links entries must be URLs or { url, label? }",
      };
    }
    const extra = unknownFields(item, ["url", "label"]);
    if (extra.length) {
      return { ok: false, error: `Unknown link field: ${extra.join(", ")}` };
    }
    if (typeof item.url !== "string") {
      return { ok: false, error: "link url is required" };
    }
    const url = checkUrl(item.url);
    if (!url) {
      return { ok: false, error: "links entries must be http(s) URLs" };
    }
    const link: BotLink = { url };
    if (item.label !== undefined) {
      const label = cleanString(item.label, 80);
      if (!label) {
        return { ok: false, error: "link label must be 1–80 characters" };
      }
      link.label = label;
    }
    links.push(link);
  }
  return { ok: true, links };
}

function parseMetadata(
  raw: unknown,
):
  | {
      ok: true;
      metadata?: Record<string, string | number | boolean | null>;
    }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!isPlainObject(raw)) {
    return { ok: false, error: "metadata must be an object" };
  }
  const keys = Object.keys(raw);
  if (keys.length > 20) {
    return { ok: false, error: "metadata accepts at most 20 keys" };
  }
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    if (!META_KEY_RE.test(key)) {
      return { ok: false, error: `Invalid metadata key "${key}"` };
    }
    const val = raw[key];
    if (val === null || typeof val === "boolean") {
      metadata[key] = val;
      continue;
    }
    if (typeof val === "number") {
      if (!Number.isFinite(val)) {
        return { ok: false, error: `metadata.${key} must be a finite number` };
      }
      metadata[key] = val;
      continue;
    }
    if (typeof val === "string") {
      if (val.length > 500) {
        return { ok: false, error: `metadata.${key} is too long` };
      }
      metadata[key] = val;
      continue;
    }
    return {
      ok: false,
      error: `metadata.${key} must be a string, number, boolean, or null`,
    };
  }
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 4096) {
    return { ok: false, error: "metadata is too large (max 4096 bytes)" };
  }
  return { ok: true, metadata };
}

function parseTimestamp(
  raw: unknown,
): { ok: true; timestamp?: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "timestamp must be an ISO-8601 string" };
  }
  const ms = Date.parse(raw.trim());
  if (Number.isNaN(ms)) {
    return { ok: false, error: "timestamp must be an ISO-8601 string" };
  }
  const now = Date.now();
  if (ms > now + 5 * 60_000) {
    return { ok: false, error: "timestamp is too far in the future" };
  }
  if (ms < Date.parse("2020-01-01T00:00:00.000Z")) {
    return { ok: false, error: "timestamp is too far in the past" };
  }
  return { ok: true, timestamp: new Date(ms).toISOString() };
}

function healthFromType(type: BotEventType): HealthStatus {
  return type === "error" ? "error" : "ok";
}

function parseEvent(
  raw: Record<string, unknown>,
  ident: { botId: string; botName?: string },
  idempotencyKey: string | undefined,
): ParseResult<BotIngestPayload> {
  if (
    typeof raw.type !== "string" ||
    !EVENT_TYPES.includes(raw.type as BotEventType)
  ) {
    return {
      ok: false,
      error: 'type is required: "status" | "result" | "error"',
    };
  }
  const type = raw.type as BotEventType;
  const title = cleanString(raw.title, 200);
  if (!title) {
    return { ok: false, error: "title is required (1–200 characters)" };
  }
  const body = cleanString(raw.body, 8000);
  if (!body) {
    return { ok: false, error: "body is required (1–8000 characters)" };
  }
  const links = parseLinks(raw.links);
  if (!links.ok) return links;
  const metadata = parseMetadata(raw.metadata);
  if (!metadata.ok) return metadata;
  const timestamp = parseTimestamp(raw.timestamp);
  if (!timestamp.ok) return timestamp;
  const dispatch = parseDispatchId(raw);
  if (!dispatch.ok) return dispatch;

  const payload: BotIngestPayload = {
    botId: ident.botId,
    type,
    title,
    body,
    status: healthFromType(type),
    focus: title,
    summary: body,
  };
  if (ident.botName) payload.botName = ident.botName;
  if (links.links) payload.links = links.links;
  if (metadata.metadata) payload.metadata = metadata.metadata;
  if (timestamp.timestamp) payload.timestamp = timestamp.timestamp;
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
  if (dispatch.dispatchId) payload.dispatchId = dispatch.dispatchId;
  return { ok: true, payload };
}

function parseOptionalText(
  raw: Record<string, unknown>,
  key: string,
  max: number,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return { ok: true };
  const value = cleanString(raw[key], max);
  if (!value) {
    return { ok: false, error: `${key} must be 1–${max} characters` };
  }
  return { ok: true, value };
}

function parseMetrics(
  raw: unknown,
):
  | { ok: true; metrics?: Record<string, string | number> }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!isPlainObject(raw)) {
    return { ok: false, error: "metrics must be an object" };
  }
  const keys = Object.keys(raw);
  if (keys.length > 20) {
    return { ok: false, error: "metrics accepts at most 20 keys" };
  }
  const metrics: Record<string, string | number> = {};
  for (const key of keys) {
    if (!META_KEY_RE.test(key)) {
      return { ok: false, error: `Invalid metrics key "${key}"` };
    }
    const val = raw[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      metrics[key] = val;
      continue;
    }
    if (typeof val === "string" && val.length <= 200) {
      metrics[key] = val;
      continue;
    }
    return {
      ok: false,
      error: `metrics.${key} must be a string or finite number`,
    };
  }
  return { ok: true, metrics };
}

function parseAlerts(
  raw: unknown,
): { ok: true; alerts?: BotAlertIngest[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "alerts must be an array" };
  }
  if (raw.length > 8) {
    return { ok: false, error: "alerts accepts at most 8 items" };
  }
  const alerts: BotAlertIngest[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      return { ok: false, error: "each alert must be an object" };
    }
    const extra = unknownFields(item, ["severity", "title", "body"]);
    if (extra.length) {
      return { ok: false, error: `Unknown alert field: ${extra.join(", ")}` };
    }
    if (!isHealth(item.severity)) {
      return {
        ok: false,
        error: 'alert severity must be "ok" | "warn" | "error" | "idle"',
      };
    }
    const title = cleanString(item.title, 200);
    if (!title) {
      return { ok: false, error: "alert title is required (1–200 characters)" };
    }
    if (typeof item.body !== "string" || item.body.trim().length > 2000) {
      return { ok: false, error: "alert body must be a string up to 2000 characters" };
    }
    alerts.push({ severity: item.severity, title, body: item.body.trim() });
  }
  return { ok: true, alerts };
}

function parseData(
  raw: unknown,
):
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!isPlainObject(raw)) return { ok: false, error: "data must be an object" };
  let encoded: string;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    return { ok: false, error: "data must be JSON-serializable" };
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > 8192) {
    return { ok: false, error: "data is too large (max 8192 bytes)" };
  }
  return { ok: true, data: plainRecord(raw) };
}

function parseLegacy(
  raw: Record<string, unknown>,
  ident: { botId: string; botName?: string },
  idempotencyKey: string | undefined,
): ParseResult<BotIngestPayload> {
  if (Object.prototype.hasOwnProperty.call(raw, "status") && !isHealth(raw.status)) {
    return {
      ok: false,
      error: 'status must be "ok" | "warn" | "error" | "idle"',
    };
  }
  const focus = parseOptionalText(raw, "focus", 200);
  if (!focus.ok) return focus;
  const summary = parseOptionalText(raw, "summary", 8000);
  if (!summary.ok) return summary;
  const alerts = parseAlerts(raw.alerts);
  if (!alerts.ok) return alerts;
  const metrics = parseMetrics(raw.metrics);
  if (!metrics.ok) return metrics;
  const data = parseData(raw.data);
  if (!data.ok) return data;
  const dispatch = parseDispatchId(raw);
  if (!dispatch.ok) return dispatch;

  const payload: BotIngestPayload = { botId: ident.botId };
  if (ident.botName) payload.botName = ident.botName;
  if (isHealth(raw.status)) payload.status = raw.status;
  if (focus.value) payload.focus = focus.value;
  if (summary.value) payload.summary = summary.value;
  if (alerts.alerts) payload.alerts = alerts.alerts;
  if (metrics.metrics) payload.metrics = metrics.metrics;
  if (data.data) payload.data = data.data;
  if (dispatch.dispatchId) payload.dispatchId = dispatch.dispatchId;
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
  return { ok: true, payload };
}

/**
 * Strict ingest body.
 * Event reports: type + title + body.
 * Legacy heartbeats: status / summary / focus (no event fields).
 * Unknown keys are rejected in either shape.
 */
export function parseBotIngest(
  raw: Record<string, unknown>,
  opts?: { idempotencyKeyHeader?: string | null },
): ParseResult<BotIngestPayload> {
  const eventish = hasAny(raw, EVENT_MARKERS);
  const legacyish = hasAny(raw, LEGACY_MARKERS);
  if (eventish && legacyish) {
    return {
      ok: false,
      error:
        'Use either an event (type, title, body) or a heartbeat (status, summary, focus). Do not mix the two.',
    };
  }

  const mode = eventish ? "event" : "legacy";
  const unknown = rejectUnknown(
    raw,
    mode === "event" ? EVENT_FIELDS : LEGACY_FIELDS,
    mode === "event" ? PUBLIC_EVENT_FIELDS : PUBLIC_LEGACY_FIELDS,
  );
  if (unknown) return unknown;

  const ident = resolveIdentity(raw);
  if ("error" in ident) return { ok: false, error: ident.error };

  const idem = parseIdempotency(raw, opts?.idempotencyKeyHeader);
  if (!idem.ok) return idem;

  if (mode === "event") {
    return parseEvent(raw, ident, idem.key);
  }
  return parseLegacy(raw, ident, idem.key);
}
