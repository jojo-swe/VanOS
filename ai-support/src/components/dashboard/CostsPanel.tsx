"use client";

import { useCurrency } from "@/components/currency/CurrencyProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CostCategory, CostSnapshot } from "@/lib/costs/types";
import { CompactRow, CompactRows, TABLE_FROM_MD } from "./CompactRows";
import { StatusDot } from "./StatusDot";

type CostsResponse = CostSnapshot & {
  byCategoryDaily: Record<string, number>;
  ingest: { path: string; auth: string };
};

const CAT_LABEL: Record<CostCategory, string> = {
  llm: "LLM / API",
  mcp: "MCP / agents",
  infra: "Infra",
  saas: "SaaS",
  other: "Other",
};


export function CostsPanel() {
  // Costs arrive in USD; show them in the currency the viewer picked.
  const { format } = useCurrency();
  const money = (n: number, digits = 2) => format(n, "USD", { decimals: digits });
  const [data, setData] = useState<CostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CostCategory | "all">("all");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/costs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setData((await res.json()) as CostsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load costs");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const maxBar = useMemo(() => {
    if (!data?.series.length) return 1;
    return Math.max(
      ...data.series.map(
        (p) => p.llm + p.mcp + p.infra + p.saas + p.other,
      ),
      0.01,
    );
  }, [data]);

  const lines =
    data?.lines.filter((l) => filter === "all" || l.category === filter) ?? [];

  // Uncapped, so going over budget shows red and "130%"; only the bar width is capped.
  const budgetPct =
    data && data.budget.dailyUsd > 0
      ? (data.dailyBurnUsd / data.budget.dailyUsd) * 100
      : 0;

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Costs
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              LLM APIs · MCP / Cursor · Grok Bot · hosting — burn vs budget
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm hover:border-[var(--accent)]/40"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Daily burn"
            value={data ? money(data.dailyBurnUsd) : "—"}
            note={
              data
                ? `budget ${money(data.budget.dailyUsd, 0)}/d · ${Math.round(budgetPct)}%`
                : undefined
            }
          />
          <Stat
            label="Weekly"
            value={data ? money(data.weeklyBurnUsd) : "—"}
            note={data ? `cap ${money(data.budget.weeklyUsd, 0)}` : undefined}
          />
          <Stat
            label="Monthly pace"
            value={data ? money(data.monthlyBurnUsd) : "—"}
            note={data ? `cap ${money(data.budget.monthlyUsd, 0)}` : undefined}
          />
          <Stat
            label="Mode"
            value={data?.mode === "expensive" ? "Expensive" : "Almost Free"}
            note={
              data
                ? `LLM ${money(data.byCategoryDaily.llm ?? 0)} · MCP ${money(data.byCategoryDaily.mcp ?? 0)}`
                : undefined
            }
          />
        </div>

        <div className="mt-4">
          <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
            Daily budget
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-md bg-[var(--line)]">
            <div
              className="h-full rounded-md transition-all duration-500"
              style={{
                width: `${Math.min(100, budgetPct)}%`,
                background:
                  budgetPct > 100
                    ? "var(--danger)"
                    : budgetPct > 80
                      ? "var(--warn)"
                      : "var(--ok)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            By category (daily)
          </h3>
          <ul className="mt-3 space-y-2">
            {(
              ["llm", "mcp", "infra", "saas", "other"] as CostCategory[]
            ).map((cat) => {
              const v = data?.byCategoryDaily[cat] ?? 0;
              const pct = data ? (v / Math.max(data.dailyBurnUsd, 0.01)) * 100 : 0;
              return (
                <li key={cat}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{CAT_LABEL[cat]}</span>
                    <span className="tabular-nums font-medium">{money(v)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[var(--line)]">
                    <div
                      className="h-full rounded-sm bg-[var(--accent)]"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Last 7 days
          </h3>
          <div className="mt-4 flex h-36 items-end gap-1.5">
            {(data?.series.slice(-7) ?? []).map((p) => {
              const total = p.llm + p.mcp + p.infra + p.saas + p.other;
              const h = `${Math.max(4, (total / maxBar) * 100)}%`;
              return (
                <div
                  key={p.date}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${p.date}: ${money(total)}`}
                >
                  <div className="flex h-28 w-full flex-col justify-end overflow-hidden rounded-md bg-[var(--line)]/50">
                    <div
                      className="w-full rounded-md bg-[var(--ink)]"
                      style={{ height: h, opacity: 0.85 }}
                    />
                  </div>
                  <span className="text-[0.6rem] text-[var(--muted-fg)]">
                    {p.date.slice(5)}
                  </span>
                </div>
              );
            })}
            {!data?.series.length ? (
              <p className="text-sm text-[var(--muted-fg)]">No series yet</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Line items
          </h3>
          <div className="flex flex-wrap gap-1">
            {(
              ["all", "llm", "mcp", "infra", "saas", "other"] as const
            ).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  filter === f
                    ? "bg-[var(--ink)] text-[var(--bg)]"
                    : "text-[var(--muted-fg)] hover:bg-[var(--surface)]"
                }`}
              >
                {f === "all" ? "All" : CAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <CompactRows label="Line items" className="mt-3">
          {lines.map((l) => (
            <CompactRow
              key={l.id}
              title={l.name}
              value={money(l.amountUsd)}
              meta={
                <>
                  <StatusDot status={l.status} />
                  <span>{l.status}</span>
                  <span>· {CAT_LABEL[l.category]}</span>
                  <span>· /{l.period}</span>
                  {l.provider ? <span>· {l.provider}</span> : null}
                </>
              }
            />
          ))}
        </CompactRows>
        <div className={`data-table-scroll mt-3 min-w-0 overflow-x-auto ${TABLE_FROM_MD}`}>
          <table className="data-table w-full min-w-[720px] text-left text-sm">
            <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-medium">Service</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Period</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-[var(--line)]/70 last:border-0"
                >
                  <td className="py-3 pr-3" data-label="Service">
                    <p className="font-medium">{l.name}</p>
                    {l.note ? (
                      <p className="text-xs text-[var(--muted-fg)]">{l.note}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Provider">
                    {l.provider}
                  </td>
                  <td className="py-3 pr-3" data-label="Category">
                    {CAT_LABEL[l.category]}
                  </td>
                  <td className="py-3 pr-3 tabular-nums font-medium" data-label="Amount">
                    {money(l.amountUsd)}
                  </td>
                  <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Period">
                    /{l.period}
                  </td>
                  <td className="py-3 pr-3" data-label="Status">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={l.status} />
                      {l.status}
                    </span>
                  </td>
                  <td className="py-3 text-[var(--muted-fg)]" data-label="Source">
                    {l.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Cost alerts
          </h3>
          <ul className="mt-3 space-y-2">
            {(data?.alerts ?? []).map((a) => (
              <li
                key={a.id}
                className="flex gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                <StatusDot status={a.severity} className="mt-1.5" />
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-[var(--muted-fg)]">{a.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <details className="panel">
          <summary className="cursor-pointer font-[family-name:var(--font-display)] font-semibold">
            For agents: push live numbers
          </summary>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">
            Grok Bot / OpenClaw / a cron can POST spend to{" "}
            <code className="text-[var(--ink)]">
              {data?.ingest.path ?? "/api/costs/ingest"}
            </code>{" "}
            with the same ingest secret as bots.
          </p>
          <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 p-3 text-xs whitespace-pre-wrap">{`POST /api/costs/ingest
Authorization: Bearer $BOTS_INGEST_SECRET

{
  "reportedBy": "muddy",
  "lines": [
    {
      "id": "llm-openrouter",
      "name": "OpenRouter (agents)",
      "provider": "OpenRouter",
      "category": "llm",
      "amountUsd": 0.31,
      "period": "day",
      "note": "From usage API"
    },
    {
      "name": "Grok Bot",
      "provider": "Cursor",
      "category": "mcp",
      "amountUsd": 0.08,
      "period": "day"
    }
  ]
}`}</pre>
        </details>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 px-4 py-3">
      <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
        {label}
      </p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
        {value}
      </p>
      {note ? (
        <p className="mt-1 text-xs text-[var(--muted-fg)]">{note}</p>
      ) : null}
    </div>
  );
}
