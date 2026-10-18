import { z } from "zod";
import {
  amount,
  describeError,
  health,
  nonNegative,
  optText,
  text,
  validItems,
} from "@/lib/http/schema";
import type { CostIngestPayload } from "./types";

export type ParseResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

export const MAX_COST_LINES = 200;
/** A bit over a year of daily points. */
export const MAX_COST_SERIES = 400;

export const costLineSchema = z.object({
  id: optText(120),
  name: text(200),
  provider: text(120),
  category: z.enum(["llm", "mcp", "infra", "saas", "other"]),
  amountUsd: amount,
  period: z.enum(["day", "week", "month"]).optional(),
  status: health.optional(),
  note: optText(500),
  includedRemaining: optText(200),
});

export const costPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  llm: nonNegative.default(0),
  mcp: nonNegative.default(0),
  infra: nonNegative.default(0),
  saas: nonNegative.default(0),
  other: nonNegative.default(0),
});

export const costBudgetSchema = z
  .object({
    dailyUsd: z.number().positive(),
    weeklyUsd: z.number().positive(),
    monthlyUsd: z.number().positive(),
  })
  .partial();

const costIngestSchema = z.object({
  replace: z.boolean().optional(),
  mode: z.enum(["almost-free", "expensive"]).optional(),
  reportedBy: optText(120),
  lines: validItems(costLineSchema, MAX_COST_LINES),
  budget: costBudgetSchema.optional(),
  series: validItems(costPointSchema, MAX_COST_SERIES).optional(),
});

/**
 * Validate a cost ingest. Invalid lines and series points are skipped; an
 * invalid budget, mode or oversized list rejects the request. At least one
 * valid line is required.
 */
export function parseCostIngest(raw: Record<string, unknown>): ParseResult<CostIngestPayload> {
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    return { ok: false, error: "lines[] is required (at least one cost line)" };
  }
  const parsed = costIngestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: describeError(parsed.error) };
  if (!parsed.data.lines.length) {
    return {
      ok: false,
      error:
        "No valid lines. Each needs name, provider, category (llm|mcp|infra|saas|other), amountUsd.",
    };
  }
  const { replace, ...rest } = parsed.data;
  return { ok: true, payload: { ...rest, replace: replace === true } };
}
