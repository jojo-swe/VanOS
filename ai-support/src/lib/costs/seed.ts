import type { CostDailyPoint, CostLine, CostSnapshot } from "./types";

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function seriesFromPattern(): CostDailyPoint[] {
  // Round sample history for the default seed and the public demo.
  const pattern: Array<Omit<CostDailyPoint, "date">> = [
    { llm: 2, mcp: 0.4, infra: 0.1, saas: 0.2, other: 0 },
    { llm: 2.1, mcp: 0.3, infra: 0.1, saas: 0.2, other: 0 },
    { llm: 0.55, mcp: 0.25, infra: 0.08, saas: 0.15, other: 0 },
    { llm: 0.42, mcp: 0.2, infra: 0.08, saas: 0.15, other: 0 },
    { llm: 0.38, mcp: 0.22, infra: 0.08, saas: 0.15, other: 0 },
    { llm: 0.35, mcp: 0.18, infra: 0.08, saas: 0.15, other: 0 },
    { llm: 0.4, mcp: 0.2, infra: 0.08, saas: 0.15, other: 0 },
  ];
  return pattern.map((p, i) => ({
    date: daysAgo(pattern.length - 1 - i),
    ...p,
  }));
}

const now = () => new Date().toISOString();

export function seedCostLines(): CostLine[] {
  const t = now();
  const line = (
    id: string,
    name: string,
    provider: string,
    category: CostLine["category"],
    amountUsd: number,
    period: CostLine["period"],
    status: CostLine["status"],
    note: string,
  ): CostLine => ({ id, name, provider, category, amountUsd, period, status, note, lastUpdated: t, source: "estimate" });
  // Neutral sample lines with round numbers. No real accounts or plans.
  return [
    line("llm-provider-a", "Sample LLM provider A", "Provider A", "llm", 0.28, "day", "ok", "Sample usage estimate"),
    line("llm-provider-b", "Sample LLM provider B", "Provider B", "llm", 0.12, "day", "ok", "Sample usage estimate"),
    line("llm-provider-c", "Sample LLM provider C", "Provider C", "llm", 0, "day", "idle", "Not in use"),
    line("mcp-tools-a", "Sample tool service A", "Tools A", "mcp", 0.15, "day", "ok", "Sample usage estimate"),
    line("mcp-tools-b", "Sample tool service B", "Tools B", "mcp", 0.05, "day", "ok", "Sample usage estimate"),
    line("mcp-tools-c", "Sample tool service C", "Tools C", "mcp", 0, "month", "idle", "Not in use"),
    line("saas-hosting", "Sample hosting", "Hosting", "saas", 0, "month", "ok", "Free tier"),
    line("saas-repo", "Sample code hosting", "Code host", "saas", 0, "month", "ok", "Free tier"),
    line("infra-host", "Sample server power", "Local", "infra", 0.08, "day", "ok", "Sample estimate"),
  ];
}

export function seedCostSnapshot(): CostSnapshot {
  const lines = seedCostLines();
  const series = seriesFromPattern();
  const { dailyBurnUsd, weeklyBurnUsd, monthlyBurnUsd } = rollup(lines, series);

  return {
    updatedAt: now(),
    currency: "USD",
    mode: "almost-free",
    budget: {
      dailyUsd: 1,
      weeklyUsd: 7,
      monthlyUsd: 30,
    },
    dailyBurnUsd,
    weeklyBurnUsd,
    monthlyBurnUsd,
    lines,
    series,
    alerts: [
      {
        id: "cost-lean",
        severity: "ok",
        title: "Under daily budget",
        body: `Est. $${dailyBurnUsd.toFixed(2)}/day vs $${1}/day sample cap.`,
      },
      {
        id: "cost-budget-note",
        severity: "warn",
        title: "Sample budget note",
        body: "Round sample burn. Keep the daily cap in view.",
      },
    ],
  };
}

/** Normalize line periods to daily USD */
export function toDailyUsd(line: CostLine): number {
  if (line.period === "day") return line.amountUsd;
  if (line.period === "week") return line.amountUsd / 7;
  return line.amountUsd / 30;
}

export function rollup(lines: CostLine[], series: CostDailyPoint[]) {
  const dailyBurnUsd = lines.reduce((s, l) => s + toDailyUsd(l), 0);
  const last7 = series.slice(-7);
  const weeklyFromSeries = last7.reduce(
    (s, p) => s + p.llm + p.mcp + p.infra + p.saas + p.other,
    0,
  );
  const weeklyBurnUsd =
    weeklyFromSeries > 0 ? weeklyFromSeries : dailyBurnUsd * 7;
  const monthlyBurnUsd = dailyBurnUsd * 30;
  return { dailyBurnUsd, weeklyBurnUsd, monthlyBurnUsd };
}
