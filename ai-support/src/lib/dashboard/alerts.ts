import { convert } from "@/lib/currency/fx";
import type { Alert, DashboardData, HealthStatus } from "./types";

const SEVERITY_RANK: Record<HealthStatus, number> = {
  error: 0,
  warn: 1,
  idle: 2,
  ok: 3,
};

export const MAX_ALERTS = 16;

function atMs(alert: Alert): number | null {
  const ms = alert.at ? Date.parse(alert.at) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Worst first (broken, needs attention, idle, fine), then dated alerts
 * newest first, then undated ones in their original order. Duplicates by
 * id are dropped. Cut only after sorting, so a broken
 * item is never pushed out by good news.
 */
export function rankAlerts(alerts: Alert[], limit = MAX_ALERTS): Alert[] {
  const seen = new Set<string>();
  const unique = alerts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return unique
    .map((alert, index) => ({ alert, index }))
    .sort((x, y) => {
      const bySeverity =
        (SEVERITY_RANK[x.alert.severity] ?? 3) -
        (SEVERITY_RANK[y.alert.severity] ?? 3);
      if (bySeverity) return bySeverity;
      const xa = atMs(x.alert);
      const ya = atMs(y.alert);
      if (xa !== null && ya !== null && xa !== ya) return ya - xa;
      if (xa !== null && ya === null) return -1;
      if (xa === null && ya !== null) return 1;
      return x.index - y.index;
    })
    .slice(0, limit)
    .map(({ alert }) => alert);
}

/** Alerts that ask for a person: broken or needing attention. */
export function needsAttention(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.severity === "error" || a.severity === "warn");
}

/**
 * Last step before the dashboard is served: rank alerts and make the
 * "Agents" pulse tile count the same agents the rest of the page shows.
 */
export function finishDashboard(data: DashboardData): DashboardData {
  const total = data.agents.length;
  const attention = data.agents.filter(
    (a) => a.status === "warn" || a.status === "error",
  ).length;
  const broken = data.agents.filter((a) => a.status === "error").length;
  const ok = data.agents.filter((a) => a.status === "ok").length;

  const pulse = data.pulse.map((p) => {
    if (p.id !== "agents-online") return p;
    const reported = ok + attention > 0;
    const status: HealthStatus = broken
      ? "error"
      : attention
        ? "warn"
        : reported
          ? "ok"
          : "idle";
    return {
      ...p,
      label: "Agents OK",
      value: `${ok} / ${total}`,
      target: undefined,
      trend: "flat" as const,
      delta: undefined,
      status,
      note: attention
        ? `${attention} need attention`
        : reported
          ? "All nominal"
          : "No agent has reported yet",
    };
  });

  // MRR is the sum of the income streams, so the tile and the Income
  // section always agree.
  const mrrUsd = data.income.reduce(
    (sum, i) => sum + convert(i.mrr, i.currency ?? "USD", "USD", data.fx),
    0,
  );
  const withMrr = pulse.map((p) => {
    if (p.id !== "mrr") return p;
    return {
      ...p,
      value: `$${Math.round(mrrUsd)}`,
      money: { ...p.money, value: mrrUsd, currency: "USD" as const },
      note: data.income.length
        ? `${data.income.length} income ${data.income.length === 1 ? "stream" : "streams"}`
        : "No income reported yet",
      status: (mrrUsd > 0 ? "ok" : data.income.length ? "warn" : "idle") as HealthStatus,
    };
  });

  return { ...data, pulse: withMrr, alerts: rankAlerts(data.alerts) };
}
