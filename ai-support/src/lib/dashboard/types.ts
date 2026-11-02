export type HealthStatus = "ok" | "warn" | "error" | "idle";
export type Trend = "up" | "flat" | "down";
export type AgentRole =
  | "coo"
  | "cto"
  | "cmo"
  | "cro"
  | "engineering"
  | "marketing"
  | "revenue"
  | "community";

import type { Currency, FxRates } from "@/lib/currency/fx";

/** A metric that is an amount of money, shown in the viewer's currency. */
export interface MetricMoney {
  value: number;
  currency: Currency;
  /** Suffix such as "/d" or "/mo". */
  per?: string;
  target?: number;
  /** Text around the target, e.g. "< " and "+". */
  targetPrefix?: string;
  targetSuffix?: string;
  /** Small split shown under the value, e.g. LLM and MCP spend. */
  breakdown?: { label: string; value: number }[];
}

export interface Metric {
  id: string;
  label: string;
  /** Text fallback; `money`, when set, is what the tile shows. */
  value: string;
  money?: MetricMoney;
  target?: string;
  trend: Trend;
  delta?: string;
  note?: string;
  status?: HealthStatus;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  dept: AgentRole;
  status: HealthStatus;
  focus: string;
  lastActive: string;
}

export interface CronJob {
  id: string;
  name: string;
  agent: string;
  schedule: string;
  status: HealthStatus;
  lastRun?: string;
}

export interface ContentItem {
  id: string;
  title: string;
  channel: "blog" | "social" | "newsletter" | "video" | "seo";
  owner: string;
  stage: "idea" | "draft" | "review" | "scheduled" | "published";
  due: string;
}

export interface SocialPost {
  id: string;
  platform: "x" | "linkedin" | "tiktok" | "instagram" | "youtube";
  status: "queued" | "live" | "needs-approval" | "failed";
  preview: string;
  when: string;
  metrics?: { likes?: number; views?: number; comments?: number };
}

export interface IncomeStream {
  id: string;
  name: string;
  type: "product" | "affiliate" | "freelance" | "saas" | "other";
  mrr: number;
  /** Currency of `mrr`; USD when missing. */
  currency?: Currency;
  status: HealthStatus;
  nextAction: string;
}

export interface LifeItem {
  id: string;
  area: "focus" | "health" | "vanlife" | "money" | "relationships" | "admin";
  title: string;
  detail: string;
  priority: "now" | "soon" | "someday";
  done?: boolean;
}

export interface Integration {
  id: string;
  name: string;
  status: HealthStatus;
  detail: string;
}

/** The dashboard sections an alert or a link can point at. */
export type DashboardSection =
  | "overview"
  | "bots"
  | "costs"
  | "money"
  | "connections"
  | "integrations"
  | "home"
  | "agents"
  | "revenue"
  | "content"
  | "social"
  | "life"
  | "system"
  | "setup";

export interface Alert {
  id: string;
  severity: HealthStatus;
  title: string;
  body: string;
  /** Free-text time for seed alerts ("8h ago"). Prefer `at`. */
  when?: string;
  /** ISO time the alert's data was last updated. */
  at?: string;
  /** The section that explains or fixes the alert. */
  section?: DashboardSection;
}

export interface CostSummary {
  dailyBurnUsd: number;
  weeklyBurnUsd: number;
  monthlyBurnUsd: number;
  budgetDailyUsd: number;
  llmDailyUsd: number;
  mcpDailyUsd: number;
  status: HealthStatus;
}

export interface MoneySummary {
  subMonthlySek: number;
  expenseMonthSek: number;
  incomeMonthSek: number;
  bufferSek: number;
  billsDueSoon: number;
  sellActive: number;
  sellSoldMonthSek: number;
  status: HealthStatus;
}

export interface ConnectionsSummary {
  live: number;
  mcpReady: number;
  missing: number;
  unreadMail: number;
  openPrs: number;
  status: HealthStatus;
}

export interface DashboardData {
  generatedAt: string;
  /**
   * Set when a filesystem write failed and this body is still being served.
   * Absent while storage is healthy.
   */
  degraded?: boolean;
  /** Errno of that write, such as ENOSPC. Present only with `degraded`. */
  reason?: string;
  /** Exchange rates for converting amounts into the viewer's currency. */
  fx: FxRates;
  mode: "almost-free" | "expensive";
  mission: {
    tagline: string;
    runwayGoal: string;
    apiCostTarget: string;
    /** Percent toward the vanlife goal; missing until an agent reports it. */
    vanlifeProgress?: number;
  };
  pulse: Metric[];
  kpis: Metric[];
  agents: Agent[];
  crons: CronJob[];
  content: ContentItem[];
  social: SocialPost[];
  income: IncomeStream[];
  life: LifeItem[];
  integrations: Integration[];
  alerts: Alert[];
  costs: CostSummary;
  money: MoneySummary;
  connections: ConnectionsSummary;
  system: {
    uptime: string;
    memory: string;
    disk: string;
    gateway: HealthStatus;
    cpu: string;
  };
  schedule: { time: string; title: string; owner: string }[];
}
