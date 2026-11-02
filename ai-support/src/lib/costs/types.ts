import type { HealthStatus } from "@/lib/dashboard/types";

export type CostCategory = "llm" | "mcp" | "infra" | "saas" | "other";
export type CostPeriod = "day" | "week" | "month";

export interface CostLine {
  id: string;
  name: string;
  provider: string;
  category: CostCategory;
  /** Spend in USD for the line's period */
  amountUsd: number;
  period: CostPeriod;
  status: HealthStatus;
  note?: string;
  /** Free tier / included allowance remaining, if known */
  includedRemaining?: string;
  lastUpdated: string;
  source: "seed" | "ingest" | "estimate";
}

export interface CostDailyPoint {
  date: string; // YYYY-MM-DD
  llm: number;
  mcp: number;
  infra: number;
  saas: number;
  other: number;
}

export interface CostBudget {
  dailyUsd: number;
  weeklyUsd: number;
  monthlyUsd: number;
}

export interface CostSnapshot {
  updatedAt: string;
  currency: "USD";
  mode: "almost-free" | "expensive";
  budget: CostBudget;
  /** Normalized to estimated daily burn */
  dailyBurnUsd: number;
  weeklyBurnUsd: number;
  monthlyBurnUsd: number;
  lines: CostLine[];
  series: CostDailyPoint[];
  alerts: { id: string; severity: HealthStatus; title: string; body: string }[];
}

export interface CostIngestLine {
  id?: string;
  name: string;
  provider: string;
  category: CostCategory;
  amountUsd: number;
  period?: CostPeriod;
  status?: HealthStatus;
  note?: string;
  includedRemaining?: string;
}

export interface CostIngestPayload {
  /** Replace all ingest lines (default false = upsert by id/name+provider) */
  replace?: boolean;
  mode?: "almost-free" | "expensive";
  budget?: Partial<CostBudget>;
  lines: CostIngestLine[];
  /** Optional daily series points to merge */
  series?: CostDailyPoint[];
  reportedBy?: string;
}
