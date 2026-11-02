import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { isDemoMode } from "@/lib/security/config";
import { rollup, seedCostSnapshot, toDailyUsd } from "./seed";
import type {
  CostDailyPoint,
  CostIngestPayload,
  CostLine,
  CostSnapshot,
} from "./types";
import { keepValid } from "@/lib/http/schema";
import {
  MAX_COST_LINES,
  MAX_COST_SERIES,
  costBudgetSchema,
  costLineSchema,
  costPointSchema,
} from "./parse-ingest";

const KEY = "cost-overlay";

interface CostOverlay {
  updatedAt: string;
  reportedBy?: string;
  mode?: "almost-free" | "expensive";
  budget?: Partial<CostSnapshot["budget"]>;
  lines: CostLine[];
  series: CostDailyPoint[];
}

function emptyOverlay(): CostOverlay {
  return {
    updatedAt: new Date().toISOString(),
    lines: [],
    series: [],
  };
}

export async function getCostOverlay(): Promise<CostOverlay> {
  return normalize(await durableGetJson<CostOverlay>(KEY));
}

function normalize(disk: CostOverlay | null): CostOverlay {
  if (!disk || !Array.isArray(disk.lines)) return emptyOverlay();
  // Drop anything malformed that an older version let in, so one bad row
  // cannot break every read.
  const budget = costBudgetSchema.safeParse(disk.budget);
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    reportedBy: disk.reportedBy,
    mode: disk.mode,
    budget: budget.success ? budget.data : undefined,
    lines: (disk.lines ?? []).filter((l) => costLineSchema.safeParse(l).success),
    series: keepValid(costPointSchema, disk.series),
  };
}

function lineKey(l: Pick<CostLine, "id" | "name" | "provider">) {
  return l.id || `${l.provider}::${l.name}`.toLowerCase();
}

export async function applyCostIngest(
  payload: CostIngestPayload,
): Promise<CostSnapshot> {
  if (isDemoMode()) return getCostSnapshot();
  await durableUpdateJson<CostOverlay>(KEY, (disk) => {
    const overlay = normalize(disk);
    mergeCostIngest(overlay, payload);
    overlay.updatedAt = new Date().toISOString();
    return overlay;
  });
  return getCostSnapshot();
}

function mergeCostIngest(overlay: CostOverlay, payload: CostIngestPayload): void {
  const t = new Date().toISOString();

  if (payload.replace) overlay.lines = [];
  if (payload.mode) overlay.mode = payload.mode;
  if (payload.budget) overlay.budget = { ...overlay.budget, ...payload.budget };
  if (payload.reportedBy) overlay.reportedBy = payload.reportedBy;

  const map = new Map(overlay.lines.map((l) => [lineKey(l), l]));
  for (const row of payload.lines) {
    const id =
      row.id?.trim() ||
      `${row.provider}-${row.name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const next: CostLine = {
      id,
      name: row.name,
      provider: row.provider,
      category: row.category,
      amountUsd: Number(row.amountUsd) || 0,
      period: row.period ?? "day",
      status: row.status ?? "ok",
      note: row.note,
      includedRemaining: row.includedRemaining,
      lastUpdated: t,
      source: "ingest",
    };
    map.set(lineKey(next), next);
  }
  overlay.lines = Array.from(map.values());

  if (payload.series?.length) {
    const sMap = new Map(overlay.series.map((p) => [p.date, p]));
    for (const p of payload.series) {
      sMap.set(p.date, p);
    }
    overlay.series = Array.from(sMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_COST_SERIES);
  }
  overlay.lines = overlay.lines.slice(-MAX_COST_LINES);
}

export async function getCostSnapshot(): Promise<CostSnapshot> {
  if (isDemoMode()) return seedCostSnapshot();
  const seed = seedCostSnapshot();
  const overlay = await getCostOverlay();

  const byKey = new Map(seed.lines.map((l) => [lineKey(l), l]));
  for (const l of overlay.lines) {
    byKey.set(lineKey(l), l);
  }
  const lines = Array.from(byKey.values()).sort(
    (a, b) => toDailyUsd(b) - toDailyUsd(a),
  );

  // The seed's daily history is sample data for the demo; production
  // shows only the days agents have reported.
  const sMap = new Map<string, (typeof overlay.series)[number]>();
  for (const p of overlay.series) sMap.set(p.date, p);
  const series = Array.from(sMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const budget = {
    ...seed.budget,
    ...overlay.budget,
  };
  const mode = overlay.mode ?? seed.mode;
  const { dailyBurnUsd, weeklyBurnUsd, monthlyBurnUsd } = rollup(lines, series);

  const alerts: CostSnapshot["alerts"] = [];
  if (dailyBurnUsd > budget.dailyUsd) {
    alerts.unshift({
      id: "cost-over-daily",
      severity: "error",
      title: "Over daily budget",
      body: `$${dailyBurnUsd.toFixed(2)}/day vs $${budget.dailyUsd}/day cap.`,
    });
  } else if (dailyBurnUsd > budget.dailyUsd * 0.8) {
    alerts.unshift({
      id: "cost-near-daily",
      severity: "warn",
      title: "Approaching daily budget",
      body: `$${dailyBurnUsd.toFixed(2)}/day — ${Math.round((dailyBurnUsd / budget.dailyUsd) * 100)}% of cap.`,
    });
  }
  if (overlay.reportedBy) {
    alerts.unshift({
      id: "cost-live",
      severity: "ok",
      title: "Live cost feed",
      body: `Last update from ${overlay.reportedBy}.`,
    });
  }

  return {
    updatedAt: overlay.lines.length ? overlay.updatedAt : seed.updatedAt,
    currency: "USD",
    mode,
    budget,
    dailyBurnUsd,
    weeklyBurnUsd,
    monthlyBurnUsd,
    lines,
    series,
    alerts: alerts.slice(0, 8),
  };
}

export function categoryTotals(lines: CostLine[]) {
  const totals: Record<string, number> = {
    llm: 0,
    mcp: 0,
    infra: 0,
    saas: 0,
    other: 0,
  };
  for (const l of lines) {
    totals[l.category] = (totals[l.category] ?? 0) + toDailyUsd(l);
  }
  return totals;
}
