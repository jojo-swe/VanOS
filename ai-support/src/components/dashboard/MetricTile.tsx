"use client";

import { useCurrency } from "@/components/currency/CurrencyProvider";
import type { Metric } from "@/lib/dashboard/types";
import { StatusDot } from "./StatusDot";

const trendArrow = { up: "↑", flat: "→", down: "↓" } as const;

/** The change reads good or bad from the tile's status, not from its direction. */
const deltaTone = {
  ok: "text-[var(--ok-ink)]",
  warn: "text-[var(--warn-ink)]",
  error: "text-[var(--danger)]",
  idle: "text-[var(--muted-fg)]",
} as const;

export function MetricTile({ metric, index = 0 }: { metric: Metric; index?: number }) {
  const { format } = useCurrency();
  const m = metric.money;
  const value = m ? format(m.value, m.currency, { per: m.per }) : metric.value;
  const target =
    m && m.target !== undefined
      ? `${m.targetPrefix ?? ""}${format(m.target, m.currency, { per: m.per })}${m.targetSuffix ?? ""}`
      : metric.target;
  const note = m?.breakdown?.length
    ? m.breakdown.map((b) => `${b.label} ${format(b.value, m.currency)}`).join(" · ")
    : metric.note;
  return (
    <article
      className="metric-tile group relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-[var(--accent)]/40"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-[var(--muted-fg)]">
          {metric.label}
        </p>
        {metric.status ? <StatusDot status={metric.status} /> : null}
      </div>
      <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--ink)]">
        {value}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-fg)]">
        {metric.delta || metric.trend !== "flat" ? (
          <span className={deltaTone[metric.status ?? "idle"]}>
            {trendArrow[metric.trend]}
            {metric.delta ? ` ${metric.delta}` : ""}
          </span>
        ) : null}
        {target ? <span>target {target}</span> : null}
      </div>
      {note ? <p className="mt-1 text-xs text-[var(--muted-fg)]">{note}</p> : null}
    </article>
  );
}
