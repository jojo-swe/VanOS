import {
  CACHE_ERROR_MS,
  CACHE_OK_MS,
  clearIntegrationCache,
  readCache,
  tokenFingerprint,
  writeCache,
} from "@/lib/integrations/cache";
import { sampleObsidianSnapshot } from "@/lib/demo/sample";
import { isDemoMode } from "@/lib/security/config";
import { searchApi, listRecentFromApi } from "./api";
import { getVaultPath, isObsidianConfigured, readObsidianApi } from "./config";
import type { ObsidianIntegrationSnapshot, ObsidianNote } from "./types";
import { recentVaultNotes, resolveVault, searchVaultNotes } from "./vault";

function blank(
  partial: Pick<ObsidianIntegrationSnapshot, "configured" | "status" | "detail" | "mode"> &
    Partial<ObsidianIntegrationSnapshot>,
): ObsidianIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: partial.configured,
    status: partial.status,
    detail: partial.detail,
    mode: partial.mode,
    query: partial.query ?? null,
    vaultConfigured: partial.vaultConfigured ?? false,
    apiConfigured: partial.apiConfigured ?? false,
    notes: partial.notes ?? [],
    cached: false,
  };
}

export function clearObsidianCache(): void {
  clearIntegrationCache("obsidian:");
}

export async function getObsidianSnapshot(
  query?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ObsidianIntegrationSnapshot> {
  if (isDemoMode()) return sampleObsidianSnapshot(query);
  const q = (query ?? "").trim().slice(0, 200);
  const mode = q ? "search" : "recent";
  if (!isObsidianConfigured()) {
    return blank({
      configured: false,
      status: "idle",
      mode,
      detail:
        "Obsidian is off. Set OBSIDIAN_VAULT_PATH, or OBSIDIAN_API_URL and OBSIDIAN_API_KEY.",
    });
  }
  if (q && q.length < 2) {
    return blank({
      configured: true,
      status: "warn",
      mode: "search",
      query: q,
      detail: "Type at least 2 characters to search notes.",
      vaultConfigured: Boolean(getVaultPath()),
      apiConfigured: readObsidianApi().state === "ready",
    });
  }

  const api = readObsidianApi();
  const fingerprint = api.state === "ready" ? tokenFingerprint(api.key) : api.state;
  const key = `obsidian:${mode}:${q.toLowerCase()}:${getVaultPath() ?? ""}:${fingerprint}`;
  const hit = readCache<ObsidianIntegrationSnapshot>(key);
  if (hit) return { ...hit, cached: true };

  const loaded = await loadObsidian(q, mode, fetchImpl);
  if (loaded.status !== "idle") {
    writeCache(key, loaded, loaded.status === "error" ? CACHE_ERROR_MS : CACHE_OK_MS);
  }
  return loaded;
}

async function loadObsidian(
  query: string,
  mode: "recent" | "search",
  fetchImpl: typeof fetch,
): Promise<ObsidianIntegrationSnapshot> {
  const api = readObsidianApi();
  const vaultPath = getVaultPath();
  const apiReady = api.state === "ready";
  let vaultRoot: string | null = null;
  let vaultError: string | null = null;
  if (vaultPath) {
    const resolved = await resolveVault(vaultPath);
    if ("error" in resolved) vaultError = resolved.error;
    else vaultRoot = resolved.root;
  }

  if (!vaultRoot && !apiReady) {
    const detail =
      api.state === "partial"
        ? `Set ${api.missing} as well. The Local REST API plugin needs both URL and key.`
        : api.state === "invalid"
          ? api.detail
          : vaultError || "Obsidian is not configured.";
    return blank({
      configured: true,
      status: vaultError || api.state === "invalid" ? "error" : "warn",
      mode,
      query: query || null,
      detail,
      vaultConfigured: Boolean(vaultPath),
      apiConfigured: false,
    });
  }

  const warnings: string[] = [];
  if (vaultError && apiReady) warnings.push(vaultError);

  let notes: ObsidianNote[] = [];
  if (mode === "search" && apiReady) {
    const found = await searchApi(api.url, api.key, api.host, query, fetchImpl);
    if (found.error) {
      warnings.push(found.error);
      if (vaultRoot) notes = await searchVaultNotes(vaultRoot, query);
    } else {
      notes = found.notes;
    }
  } else if (mode === "search" && vaultRoot) {
    notes = await searchVaultNotes(vaultRoot, query);
  } else if (vaultRoot) {
    notes = await recentVaultNotes(vaultRoot);
  } else if (apiReady) {
    const listed = await listRecentFromApi(api.url, api.key, api.host, fetchImpl);
    if (listed.error) {
      return blank({
        configured: true,
        status: "error",
        mode,
        query: query || null,
        detail: listed.error,
        vaultConfigured: Boolean(vaultPath),
        apiConfigured: true,
      });
    }
    notes = listed.notes;
    warnings.push("Recent notes are a vault listing. Set OBSIDIAN_VAULT_PATH for modification times.");
  }

  const source = vaultRoot && apiReady ? "vault and API" : vaultRoot ? "local vault" : "Obsidian API";
  const headline =
    mode === "search"
      ? `${notes.length} note${notes.length === 1 ? "" : "s"} matching “${query}” via ${source}.`
      : `${notes.length} recent note${notes.length === 1 ? "" : "s"} via ${source}.`;
  const status = warnings.length ? "warn" : "ok";
  return blank({
    configured: true,
    status,
    mode,
    query: query || null,
    detail: [headline, ...warnings].join(" "),
    vaultConfigured: Boolean(vaultRoot),
    apiConfigured: apiReady,
    notes,
  });
}
