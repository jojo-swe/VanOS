import { upstreamMessage, timedFetch } from "@/lib/integrations/http";
import {
  getNotionDatabaseIds,
  getNotionDoneValue,
  getNotionStatusProperty,
  notionDisabledDetail,
} from "./config";
import type {
  NotionDatabaseResult,
  NotionIntegrationSnapshot,
  NotionOpenRow,
} from "./types";

const TIMEOUT_MS = 8_000;

interface StatusField {
  name: string;
  type: "status" | "select";
}

export function lookupStatusProperty(
  properties: Record<string, { type?: string } | undefined>,
  wanted: string,
): { ok: true; field: StatusField } | { ok: false; detail: string } {
  const target = wanted.trim().toLowerCase();
  const names = Object.keys(properties);
  const match = names.find((name) => name.toLowerCase() === target);
  if (!match) {
    const found = names.slice(0, 8).join(", ") || "none";
    return { ok: false, detail: `No "${wanted}" property. Found: ${found}.` };
  }
  const type = properties[match]?.type;
  if (type !== "status" && type !== "select") {
    return {
      ok: false,
      detail: `"${match}" is a ${type ?? "unknown"} property. Filtering needs a status or select property.`,
    };
  }
  return { ok: true, field: { name: match, type } };
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { plain_text?: unknown }).plain_text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pageTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const prop = asRecord(value);
    if (prop?.type !== "title") continue;
    const text = richText(prop.title);
    if (text) return text.slice(0, 200);
  }
  return "Untitled";
}

function pageStatus(properties: Record<string, unknown>, field: StatusField): string {
  const prop = asRecord(properties[field.name]);
  if (!prop) return "";
  if (field.type === "status") {
    const status = asRecord(prop.status);
    return typeof status?.name === "string" ? status.name : "";
  }
  const select = asRecord(prop.select);
  return typeof select?.name === "string" ? select.name : "";
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sameStatus(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function databaseTitle(json: unknown, fallback: string): string {
  const rec = asRecord(json);
  const title = richText(rec?.title);
  return title || fallback;
}

function empty(
  partial: Pick<NotionIntegrationSnapshot, "configured" | "status" | "detail"> &
    Partial<NotionIntegrationSnapshot>,
): NotionIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: partial.configured,
    status: partial.status,
    detail: partial.detail,
    statusProperty: partial.statusProperty ?? getNotionStatusProperty(),
    doneValue: partial.doneValue ?? getNotionDoneValue(),
    rows: partial.rows ?? [],
    databases: partial.databases ?? [],
    cached: false,
  };
}

async function notionFetch(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  body?: unknown,
) {
  return timedFetch(
    `https://api.notion.com/v1${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: TIMEOUT_MS,
      secrets: [token],
      allowHosts: ["api.notion.com"],
    },
    fetchImpl,
  );
}

export function notionFilterBody(field: StatusField, doneValue: string) {
  return {
    filter: {
      property: field.name,
      [field.type]: { does_not_equal: doneValue },
    },
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    page_size: 25,
  };
}

export async function loadNotionBoard(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NotionIntegrationSnapshot> {
  const disabled = notionDisabledDetail();
  if (disabled) {
    return empty({ configured: false, status: "warn", detail: disabled });
  }

  const ids = getNotionDatabaseIds();
  const statusProperty = getNotionStatusProperty();
  const doneValue = getNotionDoneValue();
  const databases: NotionDatabaseResult[] = [];
  const rows: NotionOpenRow[] = [];
  let authFailed = false;
  let truncated = false;

  for (const id of ids) {
    if (authFailed) break;
    const schema = await notionFetch(`/databases/${id}`, token, fetchImpl);
    if (!schema.ok) {
      const detail =
        schema.status === 401
          ? "Notion rejected NOTION_TOKEN (401). Use an internal integration secret."
          : schema.status === 404 || schema.status === 403
            ? `Notion cannot read database ${id}. Share it with the internal integration.`
            : `Notion database ${id} failed (${schema.status || "network"}). ${upstreamMessage(schema.json, schema.text, [token])}`;
      databases.push({ id, title: id, openCount: 0, error: detail.slice(0, 240) });
      if (schema.status === 401) authFailed = true;
      continue;
    }

    const schemaRec = asRecord(schema.json) ?? {};
    const properties = asRecord(schemaRec.properties) ?? {};
    const typed = Object.fromEntries(
      Object.entries(properties).map(([name, value]) => {
        const prop = asRecord(value);
        return [name, { type: typeof prop?.type === "string" ? prop.type : undefined }];
      }),
    );
    const title = databaseTitle(schema.json, id);
    const lookup = lookupStatusProperty(typed, statusProperty);
    if (!lookup.ok) {
      databases.push({ id, title, openCount: 0, error: lookup.detail });
      continue;
    }

    const query = await notionFetch(
      `/databases/${id}/query`,
      token,
      fetchImpl,
      notionFilterBody(lookup.field, doneValue),
    );
    if (!query.ok) {
      const detail =
        query.status === 401
          ? "Notion rejected NOTION_TOKEN (401)."
          : `Query failed for ${title} (${query.status || "network"}). ${upstreamMessage(query.json, query.text, [token])}`;
      databases.push({ id, title, openCount: 0, error: detail.slice(0, 240) });
      if (query.status === 401) authFailed = true;
      continue;
    }

    const results = asRecord(query.json);
    const list = Array.isArray(results?.results) ? results.results : [];
    let openCount = 0;
    for (const row of list) {
      const page = asRecord(row);
      if (!page) continue;
      const props = asRecord(page.properties) ?? {};
      const status = pageStatus(props, lookup.field);
      if (status && sameStatus(status, doneValue)) continue;
      openCount += 1;
      if (rows.length >= 50) continue;
      rows.push({
        id: typeof page.id === "string" ? page.id : `${id}-${openCount}`,
        databaseId: id,
        databaseTitle: title,
        title: pageTitle(props),
        status: status || "—",
        url: safeUrl(page.url),
        editedAt: typeof page.last_edited_time === "string" ? page.last_edited_time : "",
      });
    }
    if (results?.has_more === true) truncated = true;
    databases.push({ id, title, openCount });
  }

  const errors = databases.filter((db) => db.error);
  const openCount = rows.length;
  let status: NotionIntegrationSnapshot["status"] = "ok";
  if (authFailed || (errors.length && !rows.length && databases.every((db) => db.openCount === 0 && db.error))) {
    status = "error";
  } else if (errors.length || databases.some((db) => db.error)) {
    status = "warn";
  }

  const names = databases.map((db) => db.title).join(", ");
  const detail = errors.length && !rows.length
    ? errors[0]?.error || "Notion request failed."
    : `${openCount} open row${openCount === 1 ? "" : "s"} in ${names || "the selected databases"} (${statusProperty} ≠ ${doneValue}).${truncated ? " More rows exist." : ""}`;

  return empty({
    configured: true,
    status,
    detail,
    statusProperty,
    doneValue,
    rows,
    databases,
  });
}
