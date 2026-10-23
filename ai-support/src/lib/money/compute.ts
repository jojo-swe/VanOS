import type { FxRates } from "@/lib/currency/fx";
import { monthlySek, toSek } from "./seed";
import type {
  EverydaySummary,
  EverydayTxn,
  MoneySnapshot,
  SellListing,
  Subscription,
  TaxItem,
  TaxYearSummary,
} from "./types";

export function sumSubscriptionsMonthlySek(
  subs: Subscription[],
  fx: FxRates,
): number {
  return subs
    .filter((s) => s.status === "active" || s.status === "cancel-soon")
    .reduce(
      (sum, s) => sum + monthlySek(s.amount, s.currency, s.cadence, fx),
      0,
    );
}

export function everydaySummary(
  rows: EverydayTxn[],
  fx: FxRates,
): EverydaySummary {
  let incomeMonth = 0;
  let expenseMonth = 0;
  let billsDueSoon = 0;
  let bufferSek = 0;

  const soon = Date.now() + 7 * 86_400_000;

  for (const r of rows) {
    const sek = toSek(r.amount, r.currency, fx);
    if (r.kind === "income") incomeMonth += sek;
    if (r.kind === "expense" || (r.kind === "bill" && r.recurring)) {
      expenseMonth += sek;
    }
    if (r.kind === "bill" && !r.paid && r.due) {
      const due = new Date(r.due).getTime();
      if (due <= soon) billsDueSoon += 1;
    }
    if (r.kind === "buffer") bufferSek += sek;
  }

  const netBurn = Math.max(expenseMonth - incomeMonth, 0);
  const runwayDays =
    netBurn > 0 ? Math.floor((bufferSek / netBurn) * 30) : null;

  return {
    incomeMonth,
    expenseMonth,
    billsDueSoon,
    bufferSek,
    runwayDays,
  };
}

/** Very rough SE flat ~30% on positive business profit — placeholder only */
export function taxYears(
  items: TaxItem[],
  fx: FxRates,
): TaxYearSummary[] {
  const byYear = new Map<number, TaxYearSummary>();

  for (const item of items) {
    const cur = byYear.get(item.year) ?? {
      year: item.year,
      income: 0,
      expenses: 0,
      deductions: 0,
      estimatedTax: 0,
      currency: "SEK" as const,
    };
    const sek = toSek(item.amount, item.currency, fx);
    if (item.kind === "income") cur.income += sek;
    if (item.kind === "expense") cur.expenses += sek;
    if (item.kind === "deduction") cur.deductions += sek;
    byYear.set(item.year, cur);
  }

  return Array.from(byYear.values())
    .map((y) => {
      const profit = Math.max(y.income - y.expenses - y.deductions, 0);
      return { ...y, estimatedTax: profit * 0.3 };
    })
    .sort((a, b) => b.year - a.year);
}

export function sellPipeline(listings: SellListing[], fx: FxRates) {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  let listedValue = 0;
  let soldThisMonth = 0;
  let activeListings = 0;
  let awaitingPayment = 0;

  for (const l of listings) {
    const ask = toSek(l.askPrice, l.currency, fx);
    if (l.stage === "listed" || l.stage === "negotiating") {
      listedValue += ask;
      activeListings += 1;
    }
    if (l.stage === "sold" || l.stage === "shipped") {
      awaitingPayment += 1;
    }
    if (
      (l.stage === "sold" || l.stage === "shipped" || l.stage === "paid") &&
      l.soldAt
    ) {
      const d = new Date(l.soldAt);
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
        const net =
          toSek(l.soldPrice ?? l.askPrice, l.currency, fx) -
          toSek(l.fees ?? 0, l.currency, fx);
        soldThisMonth += net;
      }
    }
  }

  return { listedValue, soldThisMonth, activeListings, awaitingPayment };
}

export function buildSnapshot(parts: {
  updatedAt: string;
  fx: FxRates;
  subscriptions: Subscription[];
  everyday: EverydayTxn[];
  taxItems: TaxItem[];
  sell: SellListing[];
  reportedBy?: string;
}): MoneySnapshot {
  const subMonthlySek = sumSubscriptionsMonthlySek(
    parts.subscriptions,
    parts.fx,
  );
  const everydaySummaryValue = everydaySummary(parts.everyday, parts.fx);
  const taxYearList = taxYears(parts.taxItems, parts.fx);
  const sell = sellPipeline(parts.sell, parts.fx);

  const alerts: MoneySnapshot["alerts"] = [];

  if (everydaySummaryValue.billsDueSoon > 0) {
    alerts.push({
      id: "money-bills",
      severity: "warn",
      title: `${everydaySummaryValue.billsDueSoon} bill(s) due within 7 days`,
      body: "Check Bills & spending and tap Mark paid once a bill is paid.",
    });
  }

  const cancelSoon = parts.subscriptions.filter((s) => s.status === "cancel-soon");
  if (cancelSoon.length) {
    alerts.push({
      id: "money-cancel",
      severity: "warn",
      title: `${cancelSoon.length} subscription(s) to cancel soon`,
      body: cancelSoon.map((s) => s.name).join(", "),
    });
  }

  const hasMoneyData =
    parts.subscriptions.length + parts.everyday.length + parts.sell.length > 0;
  if (!hasMoneyData) {
    alerts.push({
      id: "money-empty",
      severity: "idle",
      title: "No money data yet",
      body: "Ask an agent to send subscriptions, bills and income.",
    });
  } else if (everydaySummaryValue.incomeMonth <= 0) {
    alerts.push({
      id: "money-income",
      severity: "warn",
      title: "No income logged this month",
      body: "Ask an agent to report this month's income.",
    });
  }

  if (sell.awaitingPayment > 0) {
    alerts.push({
      id: "money-sell-pay",
      severity: "ok",
      title: `${sell.awaitingPayment} sale(s) awaiting payment`,
      body: "Tap Mark paid when the money arrives. Paid sales count toward this year's taxes.",
    });
  }

  if (parts.reportedBy) {
    alerts.unshift({
      id: "money-live",
      severity: "ok",
      title: "Live money feed",
      body: `Last update from ${parts.reportedBy}.`,
    });
  }

  return {
    updatedAt: parts.updatedAt,
    currency: "SEK",
    usdToSek: parts.fx.usdToSek,
    eurToSek: parts.fx.eurToSek,
    fxSource: parts.fx.source ?? "default",
    ...(parts.fx.sources ? { fxSources: parts.fx.sources } : {}),
    ...(parts.fx.riksbankDate ? { riksbankDate: parts.fx.riksbankDate } : {}),
    subscriptions: parts.subscriptions,
    everyday: parts.everyday,
    taxItems: parts.taxItems,
    sell: parts.sell,
    subMonthlySek,
    everydaySummary: everydaySummaryValue,
    taxYears: taxYearList,
    sellPipeline: sell,
    alerts: alerts.slice(0, 10),
  };
}
