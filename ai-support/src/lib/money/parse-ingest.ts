import { z } from "zod";
import { amount, describeError, optText, text, validItems } from "@/lib/http/schema";
import type { MoneyIngestPayload } from "./types";

export type ParseResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

/** Per list, both per request and in storage. */
export const MAX_MONEY_ROWS = 500;
const currency = z.enum(["SEK", "USD", "EUR"]).default("SEK");
const id = text(120);

export const MONEY_ACTION_NAMES = ["cancel", "mark-paid", "sold"] as const;

/** See MoneyDashboardChange. `null` in an ingest row clears it. */
const dashboardChange = z
  .object({
    action: z.enum(MONEY_ACTION_NAMES),
    at: text(40),
    before: z
      .object({
        status: z
          .enum(["active", "trial", "cancel-soon", "paused", "needed", "cancelled"])
          .optional(),
        cancelledAt: optText(40),
        paid: z.boolean().optional(),
        paidAt: optText(40),
        stage: z
          .enum(["idea", "listed", "negotiating", "sold", "shipped", "paid", "dead"])
          .optional(),
        soldAt: optText(40),
      })
      .optional(),
  })
  .nullable()
  .optional();

export const subscriptionSchema = z.object({
  id,
  name: text(200),
  provider: z.string().max(120).default(""),
  category: z
    .enum(["ai", "hosting", "media", "productivity", "domain", "finance", "other"])
    .default("other"),
  amount,
  currency,
  cadence: z.enum(["monthly", "yearly", "weekly"]).default("monthly"),
  status: z
    .enum(["active", "trial", "cancel-soon", "paused", "needed", "cancelled"])
    .default("active"),
  nextBilling: optText(40),
  note: optText(500),
  cancelBy: optText(40),
  cancelledAt: optText(40),
  dashboardChange,
});

export const everydaySchema = z.object({
  id,
  kind: z.enum(["income", "expense", "bill", "transfer", "buffer"]),
  label: text(200),
  amount,
  currency,
  due: optText(40),
  paid: z.boolean().optional(),
  paidAt: optText(40),
  recurring: z.boolean().optional(),
  category: z.string().max(80).default("other"),
  note: optText(500),
  dashboardChange,
});

export const taxItemSchema = z.object({
  id,
  year: z.number().int().min(1900).max(2200),
  kind: z.enum(["income", "expense", "deduction", "vat", "other"]),
  label: text(200),
  amount,
  currency,
  date: text(40),
  receipt: optText(500),
  note: optText(500),
  forBusiness: z.boolean().default(false),
});

export const sellSchema = z.object({
  id,
  title: text(200),
  channel: z.enum(["facebook", "blocket", "tradera", "sellpy", "other"]).default("other"),
  stage: z
    .enum(["idea", "listed", "negotiating", "sold", "shipped", "paid", "dead"])
    .default("idea"),
  askPrice: amount,
  soldPrice: amount.optional(),
  currency,
  listedAt: optText(40),
  soldAt: optText(40),
  fees: amount.optional(),
  paidAt: optText(40),
  note: optText(500),
  taxRelevant: z.boolean().default(false),
  dashboardChange,
});

const moneyIngestSchema = z.object({
  replace: z.boolean().optional(),
  reportedBy: optText(120),
  usdToSek: z.number().positive().max(1000).optional(),
  eurToSek: z.number().positive().max(1000).optional(),
  subscriptions: validItems(subscriptionSchema, MAX_MONEY_ROWS).optional(),
  everyday: validItems(everydaySchema, MAX_MONEY_ROWS).optional(),
  taxItems: validItems(taxItemSchema, MAX_MONEY_ROWS).optional(),
  sell: validItems(sellSchema, MAX_MONEY_ROWS).optional(),
});

/**
 * Validate a money ingest. Rows missing required fields (id, a label or
 * title, a numeric amount, a valid kind) are skipped; defaults fill in
 * currency, category and status. At least one valid row or an exchange
 * rate (usdToSek, eurToSek) is required.
 */
export function parseMoneyIngest(raw: Record<string, unknown>): ParseResult<MoneyIngestPayload> {
  const parsed = moneyIngestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: describeError(parsed.error) };
  const data = parsed.data;
  const payload: MoneyIngestPayload = {
    replace: data.replace === true,
    reportedBy: data.reportedBy,
    usdToSek: data.usdToSek,
    eurToSek: data.eurToSek,
    subscriptions: data.subscriptions,
    everyday: data.everyday,
    taxItems: data.taxItems,
    sell: data.sell,
  };

  const rows =
    (payload.subscriptions?.length ?? 0) +
    (payload.everyday?.length ?? 0) +
    (payload.taxItems?.length ?? 0) +
    (payload.sell?.length ?? 0);
  if (rows === 0 && payload.usdToSek == null && payload.eurToSek == null) {
    return {
      ok: false,
      error:
        "Provide at least one valid row in subscriptions, everyday, taxItems or sell, or usdToSek / eurToSek",
    };
  }
  return { ok: true, payload };
}
