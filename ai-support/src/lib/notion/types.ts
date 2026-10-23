import type { HealthStatus } from "@/lib/dashboard/types";

export interface NotionOpenRow {
  id: string;
  databaseId: string;
  databaseTitle: string;
  title: string;
  status: string;
  url?: string;
  editedAt: string;
}

export interface NotionDatabaseResult {
  id: string;
  title: string;
  openCount: number;
  error?: string;
}

export interface NotionIntegrationSnapshot {
  updatedAt: string;
  configured: boolean;
  status: HealthStatus;
  detail: string;
  statusProperty: string;
  doneValue: string;
  rows: NotionOpenRow[];
  databases: NotionDatabaseResult[];
  cached: boolean;
}
