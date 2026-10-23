import type { HealthStatus } from "@/lib/dashboard/types";

export interface DfScriptDef {
  id: string;
  name: string;
  /** Function name or script id understood by the Windows bridge */
  command: string;
  description?: string;
}

export interface DfRunRequest {
  scriptId?: string;
  command?: string;
  args?: string[];
  /** Optional DisplayFusion function name shortcut */
  functionName?: string;
  reportedBy?: string;
}

export interface DfRunRecord {
  id: string;
  at: string;
  scriptId?: string;
  command: string;
  args?: string[];
  accepted: boolean;
  bridgeStatus?: number;
  error?: string;
  reportedBy?: string;
  resultSummary?: string;
}

export interface DfSnapshot {
  updatedAt: string;
  configured: boolean;
  bridgeUrl?: string;
  scripts: DfScriptDef[];
  recentRuns: DfRunRecord[];
  status: HealthStatus;
  detail: string;
}
