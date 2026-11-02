import type { FxSource } from "@/lib/currency/fx";
import type { HealthStatus } from "@/lib/dashboard/types";

export type MoneyCurrency = "SEK" | "USD" | "EUR";

/** One-tap actions the dashboard can take on a money row. */
export type MoneyActionName = "cancel" | "mark-paid" | "sold";

/** What a dashboard request may ask for: an action, or undoing the last one. */
export type MoneyRequestAction = MoneyActionName | "undo";

/** The fields a dashboard action changed, as they were before it. Used by undo. */
export interface MoneyChangeBefore {
  status?: SubscriptionStatus;
  cancelledAt?: string;
  paid?: boolean;
  paidAt?: string;
  stage?: SellStage;
  soldAt?: string;
}

/**
 * Set on a row when someone changed it from the dashboard. Agents see it on
 * their next read. An ingest that would undo the change keeps it (see
 * AGENT-API.md); an ingest row with `dashboardChange: null` drops it and
 * takes the agent's row as sent. `null` is never stored.
 */
export interface MoneyDashboardChange {
  action: MoneyActionName;
  /** ISO timestamp of the change. */
  at: string;
  /** The row's previous values, so the change can be undone. */
  before?: MoneyChangeBefore;
}

export type SubscriptionCadence = "monthly" | "yearly" | "weekly";
export type SubscriptionCategory =
  | "ai"
  | "hosting"
  | "media"
  | "productivity"
  | "domain"
  | "finance"
  | "other";

export interface Subscription {
  id: string;
  name: string;
  provider: string;
  category: SubscriptionCategory;
  amount: number;
  currency: MoneyCurrency;
  cadence: SubscriptionCadence;
  status: SubscriptionStatus;
  nextBilling?: string;
  note?: string;
  cancelBy?: string;
  /** ISO timestamp, set when the subscription is marked cancelled. */
  cancelledAt?: string;
  dashboardChange?: MoneyDashboardChange | null;
}

export type SubscriptionStatus =
  | "active"
  | "trial"
  | "cancel-soon"
  | "paused"
  | "needed"
  | "cancelled";

export type EverydayKind =
  | "income"
  | "expense"
  | "bill"
  | "transfer"
  | "buffer";

export interface EverydayTxn {
  id: string;
  kind: EverydayKind;
  label: string;
  amount: number;
  currency: MoneyCurrency;
  due?: string;
  paid?: boolean;
  /** ISO timestamp, set when a bill is marked paid. */
  paidAt?: string;
  recurring?: boolean;
  category: string;
  note?: string;
  dashboardChange?: MoneyDashboardChange | null;
}

export interface EverydaySummary {
  incomeMonth: number;
  expenseMonth: number;
  billsDueSoon: number;
  bufferSek: number;
  runwayDays: number | null;
}

export type TaxKind = "income" | "expense" | "deduction" | "vat" | "other";

export interface TaxItem {
  id: string;
  year: number;
  kind: TaxKind;
  label: string;
  amount: number;
  currency: MoneyCurrency;
  date: string;
  receipt?: string;
  note?: string;
  forBusiness: boolean;
}

export interface TaxYearSummary {
  year: number;
  income: number;
  expenses: number;
  deductions: number;
  estimatedTax: number;
  currency: MoneyCurrency;
}

export type SellChannel =
  | "facebook"
  | "blocket"
  | "tradera"
  | "sellpy"
  | "other";

export type SellStage =
  | "idea"
  | "listed"
  | "negotiating"
  | "sold"
  | "shipped"
  | "paid"
  | "dead";

export interface SellListing {
  id: string;
  title: string;
  channel: SellChannel;
  stage: SellStage;
  askPrice: number;
  soldPrice?: number;
  currency: MoneyCurrency;
  listedAt?: string;
  soldAt?: string;
  fees?: number;
  /** ISO timestamp, set when the payment for a sale is marked received. */
  paidAt?: string;
  note?: string;
  taxRelevant: boolean;
  dashboardChange?: MoneyDashboardChange | null;
}

export interface MoneySnapshot {
  updatedAt: string;
  currency: MoneyCurrency;
  /** Kronor per dollar and per euro used for every total in this snapshot. */
  usdToSek: number;
  eurToSek: number;
  /** Where the rates came from; see FxRates.source. */
  fxSource: FxSource;
  /** Set only when USD and EUR come from different places. */
  fxSources?: { usd: FxSource; eur: FxSource };
  /** Day (YYYY-MM-DD) of the Riksbank rates, when a rate came from Riksbanken. */
  riksbankDate?: string;
  subscriptions: Subscription[];
  everyday: EverydayTxn[];
  taxItems: TaxItem[];
  sell: SellListing[];
  subMonthlySek: number;
  everydaySummary: EverydaySummary;
  taxYears: TaxYearSummary[];
  sellPipeline: {
    listedValue: number;
    soldThisMonth: number;
    activeListings: number;
    awaitingPayment: number;
  };
  alerts: { id: string; severity: HealthStatus; title: string; body: string }[];
}

export interface MoneyIngestPayload {
  replace?: boolean;
  reportedBy?: string;
  usdToSek?: number;
  eurToSek?: number;
  subscriptions?: Subscription[];
  everyday?: EverydayTxn[];
  taxItems?: TaxItem[];
  sell?: SellListing[];
}
