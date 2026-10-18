import {
  CACHE_ERROR_MS,
  CACHE_OK_MS,
  clearIntegrationCache,
  readCache,
  tokenFingerprint,
  writeCache,
} from "@/lib/integrations/cache";
import { sampleNotionSnapshot } from "@/lib/demo/sample";
import { isDemoMode } from "@/lib/security/config";
import { getNotionDoneValue, getNotionStatusProperty, getNotionToken, notionDisabledDetail } from "./config";
import { loadNotionBoard } from "./client";
import type { NotionIntegrationSnapshot } from "./types";

function off(detail: string, status: NotionIntegrationSnapshot["status"]): NotionIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: false,
    status,
    detail,
    statusProperty: getNotionStatusProperty(),
    doneValue: getNotionDoneValue(),
    rows: [],
    databases: [],
    cached: false,
  };
}

export function clearNotionCache(): void {
  clearIntegrationCache("notion:");
}

export async function getNotionSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<NotionIntegrationSnapshot> {
  if (isDemoMode()) return sampleNotionSnapshot();
  const token = getNotionToken();
  const disabled = notionDisabledDetail();
  if (!token || disabled) {
    return off(
      disabled ??
        "Notion is off. Set NOTION_TOKEN (internal integration) and NOTION_DATABASE_IDS.",
      token ? "warn" : "idle",
    );
  }
  const key = `notion:${tokenFingerprint(token)}:${getNotionDoneValue()}:${getNotionStatusProperty()}`;
  const hit = readCache<NotionIntegrationSnapshot>(key);
  if (hit) return { ...hit, cached: true };
  const loaded = await loadNotionBoard(token, fetchImpl);
  writeCache(key, loaded, loaded.status === "error" ? CACHE_ERROR_MS : CACHE_OK_MS);
  return loaded;
}
