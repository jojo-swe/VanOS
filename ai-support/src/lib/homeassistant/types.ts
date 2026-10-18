import type { HealthStatus } from "@/lib/dashboard/types";

export interface HaEntityState {
  entityId: string;
  state: string;
  friendlyName?: string;
  domain?: string;
  unit?: string;
  lastChanged?: string;
  attrs?: Record<string, string | number | boolean>;
}

export interface HaServiceCall {
  domain: string;
  service: string;
  entityId?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
}

export interface HaSnapshot {
  updatedAt: string;
  configured: boolean;
  reachable: boolean;
  baseUrl?: string;
  version?: string;
  locationName?: string;
  entities: HaEntityState[];
  recentCalls: HaCallRecord[];
  status: HealthStatus;
  detail: string;
}

export interface HaCallRecord {
  id: string;
  at: string;
  domain: string;
  service: string;
  entityId?: string;
  ok: boolean;
  error?: string;
  reportedBy?: string;
}
