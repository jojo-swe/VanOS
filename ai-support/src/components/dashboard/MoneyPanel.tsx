"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrency } from "@/components/currency/CurrencyProvider";
import { describeFxRates, formatCurrency, isCurrency } from "@/lib/currency/fx";
import type {
  EverydayKind,
  EverydayTxn,
  MoneyRequestAction,
  MoneySnapshot,
  SellListing,
  SellStage,
  Subscription,
  SubscriptionStatus,
  TaxKind,
} from "@/lib/money/types";
import { CompactRow, CompactRows, TABLE_FROM_MD } from "./CompactRows";
import { StatusDot } from "./StatusDot";

type Tab = "subscriptions" | "everyday" | "tax" | "sell";
type ActionKind = "subscription" | "everyday" | "sell";

type MoneyResponse = MoneySnapshot & {
  ingest: { path: string; auth: string };
  actions?: { path: string; enabled: boolean };
};

/* ------------------------------------------------------------------------ */
/* Formatting. Data only arrives after mount, so none of this runs on the   */
/* server and the viewer's own time zone is safe to use.                    */
/* ------------------------------------------------------------------------ */

/**
 * Money formatting in the viewer's chosen currency. A row kept in another
 * currency also shows its own amount: "129 kr · $12.00".
 */
function useMoneyFormat() {
  const { currency, format } = useCurrency();
  const asIs = (n: number, from: string) => (isCurrency(from) ? format(n, from) : String(n));
  return {
    sek: (n: number) => format(n, "SEK"),
    money: asIs,
    row: (n: number, from: string) =>
      isCurrency(from) && from !== currency && n !== 0
        ? `${format(n, from)} · ${formatCurrency(n, from)}`
        : asIs(n, from),
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

/** `2026-10-17` stays as is; a timestamp becomes `2026-10-17 14:05` local time. */
function when(value?: string) {
  if (!value) return "";
  if (DATE_ONLY.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : DATE_TIME.format(d);
}

const CADENCE: Record<Subscription["cadence"], string> = { monthly: "mo", yearly: "yr", weekly: "wk" };

const SUB_STATUS: Record<SubscriptionStatus, { label: string; tone: "ok" | "warn" | "error" | "idle" }> = {
  active: { label: "Active", tone: "ok" },
  trial: { label: "Trial", tone: "warn" },
  "cancel-soon": { label: "Cancel soon", tone: "warn" },
  paused: { label: "Paused", tone: "idle" },
  needed: { label: "Needed", tone: "idle" },
  cancelled: { label: "Cancelled", tone: "idle" },
};

const CATEGORY: Record<string, string> = {
  ai: "AI",
  hosting: "Hosting",
  media: "Media",
  productivity: "Productivity",
  domain: "Domain",
  finance: "Finance",
  other: "Other",
};

const EVERYDAY_KIND: Record<EverydayKind, string> = {
  income: "Income",
  expense: "Expense",
  bill: "Bill",
  transfer: "Transfer",
  buffer: "Savings buffer",
};

const TAX_KIND: Record<TaxKind, string> = {
  income: "Income",
  expense: "Cost",
  deduction: "Deduction",
  vat: "VAT",
  other: "Other",
};

const STAGE: Record<SellStage, string> = {
  idea: "Idea",
  listed: "Listed",
  negotiating: "Negotiating",
  sold: "Sold",
  shipped: "Shipped",
  paid: "Paid",
  dead: "Withdrawn",
};

const CHANNEL: Record<SellListing["channel"], string> = {
  facebook: "Facebook",
  blocket: "Blocket",
  tradera: "Tradera",
  sellpy: "Sellpy",
  other: "Other",
};

function label(map: Record<string, string>, key: string) {
  return map[key] ?? key;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "subscriptions", label: "Subscriptions" },
  { id: "everyday", label: "Bills & spending" },
  { id: "tax", label: "Taxes" },
  { id: "sell", label: "For sale" },
];

/* ------------------------------------------------------------------------ */
/* Row actions                                                              */
/* ------------------------------------------------------------------------ */

interface RowAction {
  kind: ActionKind;
  id: string;
  action: MoneyRequestAction;
  label: string;
  /** Ask before running, with this question. */
  confirm?: string;
  /** Show as a quiet text link instead of a button (rarely needed actions). */
  subtle?: boolean;
}

interface RowState {
  pending?: boolean;
  confirming?: boolean;
  message?: string;
  error?: string;
}

const DONE: Record<MoneyRequestAction, [changed: string, unchanged: string]> = {
  "mark-paid": ["Marked paid", "Already paid"],
  cancel: ["Marked cancelled", "Already cancelled"],
  sold: ["Marked sold", "Already sold"],
  undo: ["Undone", "Nothing to undo"],
};

/** Undo for a row the dashboard changed (one step back). */
function undoAction(
  kind: ActionKind,
  row: { id: string; dashboardChange?: { before?: unknown } | null },
): RowAction | null {
  if (!row.dashboardChange?.before) return null;
  return { kind, id: row.id, action: "undo", label: "Undo" };
}

function subscriptionAction(s: Subscription): RowAction | null {
  if (s.status === "cancelled") return null;
  // A clear button where cancelling is likely; a quiet link everywhere else.
  const likely = s.status === "cancel-soon" || s.status === "trial";
  return {
    kind: "subscription",
    id: s.id,
    action: "cancel",
    label: likely ? "Mark cancelled" : "Cancel…",
    subtle: !likely,
    confirm: `Mark ${s.name} as cancelled? This only updates Mission Control. Cancel with ${s.provider || "the provider"} too.`,
  };
}

function everydayAction(row: EverydayTxn): RowAction | null {
  if (row.kind !== "bill" || row.paid) return null;
  return { kind: "everyday", id: row.id, action: "mark-paid", label: "Mark paid" };
}

function sellAction(l: SellListing): RowAction | null {
  if (l.stage === "paid") return null;
  if (l.stage === "sold" || l.stage === "shipped") {
    return { kind: "sell", id: l.id, action: "mark-paid", label: "Mark paid" };
  }
  return { kind: "sell", id: l.id, action: "sold", label: "Mark sold" };
}

function rowKey(kind: ActionKind, id: string) {
  return `${kind}:${id}`;
}

function replaceRow(data: MoneyResponse, kind: ActionKind, row: unknown): MoneyResponse {
  const swap = <T extends { id: string }>(rows: T[]) =>
    rows.map((r) => (r.id === (row as T).id ? (row as T) : r));
  if (kind === "subscription") return { ...data, subscriptions: swap(data.subscriptions) };
  if (kind === "everyday") return { ...data, everyday: swap(data.everyday) };
  return { ...data, sell: swap(data.sell) };
}

/* ------------------------------------------------------------------------ */

export function MoneyPanel() {
  const { sek, money, row: rowMoney } = useMoneyFormat();
  const [data, setData] = useState<MoneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/money", { cache: "no-store" });
      if (!res.ok) throw new Error(`Couldn't load the money data (status ${res.status}).`);
      setData((await res.json()) as MoneyResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the money data.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const setRow = useCallback((key: string, state: RowState) => {
    setRows((prev) => ({ ...prev, [key]: state }));
  }, []);

  const runAction = useCallback(
    async (a: RowAction) => {
      const key = rowKey(a.kind, a.id);
      setRow(key, { pending: true });
      try {
        const res = await fetch("/api/money/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: a.kind, id: a.id, action: a.action }),
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          changed?: boolean;
          row?: unknown;
        };
        if (!res.ok) throw new Error(body.error ?? `That didn't work (status ${res.status}).`);
        if (body.row) setData((prev) => (prev ? replaceRow(prev, a.kind, body.row) : prev));
        setRow(key, { message: DONE[a.action][body.changed ? 0 : 1] });
        // Totals and alerts are computed on the server.
        void refresh();
      } catch (e) {
        setRow(key, { error: e instanceof Error ? e.message : "That didn't work. Try again." });
      }
    },
    [refresh, setRow],
  );

  const actionsOn = data?.actions?.enabled ?? false;

  const actionCell = (
    a: RowAction | null,
    kind: ActionKind,
    id: string,
    undo: RowAction | null = null,
  ) => (
    <ActionControl
      action={a}
      undo={undo}
      state={rows[rowKey(kind, id)] ?? {}}
      enabled={actionsOn}
      onRun={(x) => void runAction(x)}
      onConfirm={(confirming) => setRow(rowKey(kind, id), { confirming })}
    />
  );

  const e = data?.everydaySummary;

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Money
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              Subscriptions, bills, taxes and things for sale
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
        {data && !actionsOn ? (
          <p className="mt-3 text-xs text-[var(--muted-fg)]">
            The Mark paid, Mark cancelled and Mark sold buttons are off in the demo.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Subscriptions / month"
            value={data ? sek(data.subMonthlySek) : "—"}
            note={
              data
                ? describeFxRates({
                    usdToSek: data.usdToSek,
                    eurToSek: data.eurToSek,
                    source: data.fxSource,
                    sources: data.fxSources,
                    riksbankDate: data.riksbankDate,
                  })
                : undefined
            }
          />
          <Stat
            label="Spending / month"
            value={e ? sek(e.expenseMonth) : "—"}
            note={e ? `Income ${sek(e.incomeMonth)}` : undefined}
          />
          <Stat
            label="Buffer"
            value={e ? sek(e.bufferSek) : "—"}
            note={
              e?.runwayDays != null
                ? `About ${e.runwayDays} days of runway`
                : "Add income to see runway"
            }
          />
          <Stat
            label="Sold this month"
            value={data ? sek(data.sellPipeline.soldThisMonth) : "—"}
            note={
              data
                ? `${data.sellPipeline.activeListings} for sale · ${data.sellPipeline.awaitingPayment} awaiting payment`
                : undefined
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="Money sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? "bg-[var(--ink)] text-[var(--bg)]"
                  : "text-[var(--muted-fg)] hover:bg-[var(--surface)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "subscriptions" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Subscriptions
          </h3>
          {data && !data.subscriptions.length ? <NothingYet what="subscriptions" /> : null}
          <CompactRows label="Subscriptions" className="mt-3">
            {(data?.subscriptions ?? []).map((s) => (
              <CompactRow
                key={s.id}
                title={s.name}
                value={<SubPrice s={s} />}
                meta={
                  <>
                    <SubStatus status={s.status} />
                    <span>· {label(CATEGORY, s.category)}</span>
                    <SubDates s={s} prefix="· " />
                  </>
                }
                footer={actionCell(subscriptionAction(s), "subscription", s.id, undoAction("subscription", s))}
              />
            ))}
          </CompactRows>
          <div className={`data-table-scroll mt-3 min-w-0 overflow-x-auto ${TABLE_FROM_MD}`}>
            <table className="data-table w-full min-w-[720px] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="py-2 pr-3 font-medium">Service</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Next</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.subscriptions ?? []).map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--line)]/70 last:border-0"
                  >
                    <td className="py-3 pr-3" data-label="Service">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-[var(--muted-fg)]">
                        {s.provider}
                        {s.note ? ` · ${s.note}` : ""}
                      </p>
                    </td>
                    <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Category">
                      {label(CATEGORY, s.category)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums" data-label="Price">
                      <SubPrice s={s} />
                    </td>
                    <td className="py-3 pr-3" data-label="Status">
                      <SubStatus status={s.status} />
                    </td>
                    <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Next">
                      <SubDates s={s} empty="—" />
                    </td>
                    <td className="py-3 text-right" data-label="Actions">
                      {actionCell(subscriptionAction(s), "subscription", s.id, undoAction("subscription", s))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "everyday" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Bills & spending
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {e
              ? e.billsDueSoon === 1
                ? "1 unpaid bill is due within 7 days."
                : `${e.billsDueSoon} unpaid bills are due within 7 days.`
              : "…"}
          </p>
          {data && !data.everyday.length ? <NothingYet what="bills or spending" /> : null}
          <ul className="mt-4 space-y-2">
            {(data?.everyday ?? []).map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 font-medium">
                    {row.kind === "bill" && !row.paid ? <StatusDot status="warn" /> : null}
                    <span className="truncate">{row.label}</span>
                  </p>
                  <p className="shrink-0 tabular-nums font-semibold">
                    {rowMoney(row.amount, row.currency)}
                  </p>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <p className="min-w-0 text-xs text-[var(--muted-fg)]">
                    {EVERYDAY_KIND[row.kind]} · {row.category}
                    {row.due ? ` · due ${when(row.due)}` : ""}
                    {row.kind === "bill" && row.paid
                      ? row.paidAt
                        ? ` · paid ${when(row.paidAt)}`
                        : " · paid"
                      : ""}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                  {actionCell(everydayAction(row), "everyday", row.id, undoAction("everyday", row))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "tax" && (
        <div className="space-y-4">
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Tax years (estimate)
            </h3>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              A rough 30% of profit. Not tax advice. Keep your receipts.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(data?.taxYears ?? []).map((y) => (
                <div
                  key={y.year}
                  className="rounded-xl border border-[var(--line)] px-4 py-3"
                >
                  <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
                    {y.year}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted-fg)]">Income</dt>
                      <dd>{sek(y.income)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted-fg)]">Costs</dt>
                      <dd>{sek(y.expenses)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted-fg)]">Deductions</dt>
                      <dd>{sek(y.deductions)}</dd>
                    </div>
                    <div className="flex justify-between font-medium">
                      <dt>Estimated tax</dt>
                      <dd>{sek(y.estimatedTax)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Tax records
            </h3>
            <ul className="mt-3 space-y-2">
              {(data?.taxItems ?? []).map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{t.label}</span>
                    <span className="shrink-0 tabular-nums">
                      {rowMoney(t.amount, t.currency)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {t.year} · {label(TAX_KIND, t.kind)}
                    {t.forBusiness ? " · business" : " · private"}
                    {t.date ? ` · ${when(t.date)}` : ""}
                    {t.receipt ? ` · receipt: ${t.receipt}` : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === "sell" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            For sale
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Facebook Marketplace, Blocket, Tradera and more. Listed for{" "}
            {data ? sek(data.sellPipeline.listedValue) : "—"} in total.
          </p>
          {data && !data.sell.length ? <NothingYet what="items for sale" /> : null}
          <CompactRows label="For sale" className="mt-4">
            {(data?.sell ?? []).map((l) => (
              <CompactRow
                key={l.id}
                title={l.title}
                value={rowMoney(l.soldPrice ?? l.askPrice, l.currency)}
                meta={
                  <>
                    <SellStageChip stage={l.stage} />
                    <span>{label(CHANNEL, l.channel)}</span>
                    {l.fees ? <span>· fees {money(l.fees, l.currency)}</span> : null}
                    <SellDates l={l} prefix="· " />
                  </>
                }
                footer={actionCell(sellAction(l), "sell", l.id, undoAction("sell", l))}
              />
            ))}
          </CompactRows>
          <div className={`data-table-scroll mt-4 min-w-0 overflow-x-auto ${TABLE_FROM_MD}`}>
            <table className="data-table w-full min-w-[680px] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Taxable?</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.sell ?? []).map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-[var(--line)]/70 last:border-0"
                  >
                    <td className="py-3 pr-3" data-label="Item">
                      <p className="font-medium">{l.title}</p>
                      {l.note || l.soldAt ? (
                        <p className="text-xs text-[var(--muted-fg)]">
                          <SellDates l={l} />
                          {l.note ? `${l.soldAt ? " · " : ""}${l.note}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Channel">
                      {label(CHANNEL, l.channel)}
                    </td>
                    <td className="py-3 pr-3" data-label="Stage">
                      <SellStageChip stage={l.stage} />
                    </td>
                    <td className="py-3 pr-3 tabular-nums" data-label="Price">
                      {rowMoney(l.soldPrice ?? l.askPrice, l.currency)}
                      {l.fees ? (
                        <span className="text-xs text-[var(--muted-fg)]">
                          {" "}
                          −{money(l.fees, l.currency)} fees
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-[var(--muted-fg)]" data-label="Taxable?">
                      {l.taxRelevant ? "Yes" : "No"}
                    </td>
                    <td className="py-3 text-right" data-label="Actions">
                      {actionCell(sellAction(l), "sell", l.id, undoAction("sell", l))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Money alerts
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
        <div className="panel self-start">
          <details>
            <summary className="cursor-pointer font-[family-name:var(--font-display)] font-semibold">
              For agents: sending live data
            </summary>
            <p className="mt-2 text-sm text-[var(--muted-fg)]">
              Agents post to{" "}
              <code className="text-[var(--ink)]">
                {data?.ingest.path ?? "/api/money/ingest"}
              </code>{" "}
              with the ingest secret. Grok Bot or n8n can sync bank, subscriptions and
              sales. Rows you mark here keep their mark until an agent sends a newer state;
              see AGENT-API.md.
            </p>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 p-3 text-xs whitespace-pre-wrap">{`{
  "reportedBy": "muddy",
  "everyday": [{
    "id": "ev-stipend",
    "kind": "income",
    "label": "Sample stipend",
    "amount": 20000,
    "currency": "SEK",
    "category": "work",
    "recurring": true
  }],
  "sell": [{
    "id": "sell-lamp",
    "title": "Sample lamp",
    "channel": "other",
    "stage": "paid",
    "askPrice": 500,
    "soldPrice": 500,
    "currency": "SEK",
    "soldAt": "2026-10-07",
    "taxRelevant": false
  }]
}`}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function ActionControl({
  action,
  undo,
  state,
  enabled,
  onRun,
  onConfirm,
}: {
  action: RowAction | null;
  undo?: RowAction | null;
  state: RowState;
  enabled: boolean;
  onRun: (a: RowAction) => void;
  onConfirm: (confirming: boolean) => void;
}) {
  const result = state.error ? (
    <span role="alert" className="text-xs text-[var(--danger)]">
      {state.error}
    </span>
  ) : state.message ? (
    <span role="status" className="text-xs font-medium text-[var(--ok-ink)]">
      {state.message}
    </span>
  ) : null;

  const undoButton = undo ? (
    <button
      type="button"
      disabled={!enabled || state.pending}
      onClick={() => onRun(undo)}
      className="whitespace-nowrap text-xs font-medium text-[var(--accent-ink)] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Undo
    </button>
  ) : null;

  if (!action) {
    return result || undoButton ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {result}
        {undoButton}
      </div>
    ) : null;
  }

  if (state.confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 text-left md:justify-end">
        <span className="w-full text-xs text-[var(--muted-fg)] md:max-w-[16rem]">{action.confirm}</span>
        <button
          type="button"
          onClick={() => onRun(action)}
          className="rounded-md border border-[var(--danger)] px-2.5 py-1 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10"
        >
          Yes, {action.action === "cancel" ? "mark cancelled" : action.label.toLowerCase()}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(false)}
          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)]/40"
        >
          Keep it
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {result}
      {undoButton}
      <button
        type="button"
        disabled={!enabled || state.pending}
        title={enabled ? undefined : "Off in the demo"}
        onClick={() => (action.confirm ? onConfirm(true) : onRun(action))}
        className={
          action.subtle
            ? "whitespace-nowrap text-xs text-[var(--muted-fg)] underline-offset-2 hover:text-[var(--ink)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            : "whitespace-nowrap rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {state.pending ? "Saving…" : action.label}
      </button>
    </div>
  );
}

function NothingYet({ what }: { what: string }) {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted-fg)]">
      No {what} yet. An agent adds them when it sends money data (see For agents below).
    </p>
  );
}

function SubPrice({ s }: { s: Subscription }) {
  const { row } = useMoneyFormat();
  return (
    <>
      {row(s.amount, s.currency)}
      <span className="font-normal text-[var(--muted-fg)]">/{CADENCE[s.cadence]}</span>
    </>
  );
}

function SubDates({ s, prefix = "", empty = null }: { s: Subscription; prefix?: string; empty?: string | null }) {
  const text =
    s.status === "cancelled"
      ? s.cancelledAt
        ? `Cancelled ${when(s.cancelledAt)}`
        : null
      : s.nextBilling
        ? `Next ${when(s.nextBilling)}`
        : s.cancelBy
          ? `Cancel by ${when(s.cancelBy)}`
          : null;
  if (!text) return empty;
  return (
    <span>
      {prefix}
      {text}
    </span>
  );
}

function SellDates({ l, prefix = "" }: { l: SellListing; prefix?: string }) {
  const text = l.paidAt ? `Paid ${when(l.paidAt)}` : l.soldAt ? `Sold ${when(l.soldAt)}` : null;
  if (!text) return null;
  return (
    <span>
      {prefix}
      {text}
    </span>
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

function SubStatus({ status }: { status: SubscriptionStatus }) {
  const s = SUB_STATUS[status] ?? { label: status, tone: "idle" as const };
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot status={s.tone} />
      {s.label}
    </span>
  );
}

function SellStageChip({ stage }: { stage: SellStage }) {
  const tones: Record<string, string> = {
    idea: "bg-[var(--line)] text-[var(--muted-fg)]",
    listed: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
    negotiating: "bg-[var(--warn-soft)] text-[var(--warn-ink)]",
    sold: "bg-[var(--ok-soft)] text-[var(--ok-ink)]",
    shipped: "bg-[var(--ok-soft)] text-[var(--ok-ink)]",
    paid: "bg-[var(--ink)] text-[var(--bg)]",
    dead: "bg-[var(--line)] text-[var(--muted-fg)]",
  };
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tones[stage] ?? tones.idea}`}
    >
      {label(STAGE, stage)}
    </span>
  );
}
