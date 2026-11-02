import {
  CACHE_ERROR_MS,
  CACHE_OK_MS,
  clearIntegrationCache,
  readCache,
  tokenFingerprint,
  writeCache,
} from "@/lib/integrations/cache";
import { isDemoMode } from "@/lib/security/config";
import { sampleGithubSnapshot } from "@/lib/demo/sample";
import { getGithubOwner, getGithubToken } from "./config";
import { loadGithubBoard } from "./client";
import type { GithubIntegrationSnapshot } from "./types";

function disabled(): GithubIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: false,
    owner: null,
    status: "idle",
    detail: "GitHub is off. Set GITHUB_TOKEN (fine-grained, read-only) and GITHUB_OWNER.",
    repoCount: 0,
    reposScanned: 0,
    openPrs: [],
    commits: [],
    failingRuns: [],
    cached: false,
  };
}

export function clearGithubCache(): void {
  clearIntegrationCache("github:");
}

export async function getGithubSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<GithubIntegrationSnapshot> {
  if (isDemoMode()) return sampleGithubSnapshot();
  const token = getGithubToken();
  if (!token) return disabled();
  const owner = getGithubOwner();
  const key = `github:${owner.toLowerCase()}:${tokenFingerprint(token)}`;
  const hit = readCache<GithubIntegrationSnapshot>(key);
  if (hit) return { ...hit, cached: true };
  const loaded = await loadGithubBoard(token, owner, fetchImpl);
  writeCache(key, loaded, loaded.status === "error" ? CACHE_ERROR_MS : CACHE_OK_MS);
  return loaded;
}
