import type { HealthStatus } from "@/lib/dashboard/types";

export interface ObsidianNote {
  path: string;
  title: string;
  updatedAt?: string;
  excerpt: string;
  source: "vault" | "api";
}

export interface ObsidianIntegrationSnapshot {
  updatedAt: string;
  configured: boolean;
  status: HealthStatus;
  detail: string;
  mode: "recent" | "search";
  query: string | null;
  vaultConfigured: boolean;
  apiConfigured: boolean;
  notes: ObsidianNote[];
  cached: boolean;
}
