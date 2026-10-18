import { z } from "zod";
import { describeError, text } from "@/lib/http/schema";
import { MAX_MONEY_ROWS, MONEY_ACTION_NAMES } from "./parse-ingest";
import { effectiveRows, upsertById, type MoneyCollections, type MoneyOverlay } from "./overlay";
import type {
  EverydayTxn,
  MoneyActionName,
  MoneyChangeBefore,
  MoneyRequestAction,
  SellListing,
  SellStage,
  Subscription,
} from "./types";

/** A dashboard action body is three short fields. */
export const MONEY_ACTION_MAX_BYTES = 2 * 1024;

export type MoneyActionKind = "subscription" | "everyday" | "sell";

/** Which actions each kind of row takes. Anything else is a 400. */
export const MONEY_ACTIONS: Record<MoneyActionKind, readonly MoneyRequestAction[]> = {
  subscription: ["cancel", "undo"],
  everyday: ["mark-paid", "undo"],
  sell: ["sold", "mark-paid", "undo"],
};

export interface MoneyActionRequest {
  kind: MoneyActionKind;
  id: string;
  action: MoneyRequestAction;
}

const actionSchema = z
  .object({
    kind: z.enum(["subscription", "everyday", "sell"]),
    id: text(120),
    action: z.enum([...MONEY_ACTION_NAMES, "undo"]),
  })
  .strict();

export type ParseActionResult =
  | { ok: true; request: MoneyActionRequest }
  | { ok: false; error: string };

export function parseMoneyAction(raw: Record<string, unknown>): ParseActionResult {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: describeError(parsed.error) };
  const { kind, id, action } = parsed.data;
  if (!MONEY_ACTIONS[kind].includes(action)) {
    return {
      ok: false,
      error: `action "${action}" does not apply to ${kind} rows (allowed: ${MONEY_ACTIONS[kind].join(", ")})`,
    };
  }
  return { ok: true, request: { kind, id, action } };
}

export type MoneyActionOutcome =
  | { status: "changed" | "unchanged"; row: Subscription | EverydayTxn | SellListing }
  | { status: "not-found" }
  | { status: "invalid"; error: string };

type RowResult<T> = { row: T; changed: boolean } | { error: string };

const STAGE_RANK: Record<SellStage, number> = {
  dead: 0,
  idea: 0,
  listed: 1,
  negotiating: 2,
  sold: 3,
  shipped: 4,
  paid: 5,
};

function cancelSubscription(row: Subscription, now: string): RowResult<Subscription> {
  if (row.status === "cancelled") return { row, changed: false };
  return {
    changed: true,
    row: {
      ...row,
      status: "cancelled",
      cancelledAt: now,
      dashboardChange: { action: "cancel", at: now, before: { status: row.status, cancelledAt: row.cancelledAt } },
    },
  };
}

function markBillPaid(row: EverydayTxn, now: string): RowResult<EverydayTxn> {
  if (row.kind !== "bill") return { error: `"${row.label}" is not a bill, so it cannot be marked paid` };
  if (row.paid) return { row, changed: false };
  return {
    changed: true,
    row: {
      ...row,
      paid: true,
      paidAt: now,
      dashboardChange: { action: "mark-paid", at: now, before: { paid: row.paid, paidAt: row.paidAt } },
    },
  };
}

function changeSale(row: SellListing, action: MoneyActionName, now: string): RowResult<SellListing> {
  const soldAt = row.soldAt ?? now.slice(0, 10);
  const before = { stage: row.stage, soldAt: row.soldAt, paidAt: row.paidAt };
  if (action === "sold") {
    if (STAGE_RANK[row.stage] >= STAGE_RANK.sold) return { row, changed: false };
    return {
      changed: true,
      row: { ...row, stage: "sold", soldAt, dashboardChange: { action: "sold", at: now, before } },
    };
  }
  if (row.stage === "paid") return { row, changed: false };
  return {
    changed: true,
    row: { ...row, stage: "paid", soldAt, paidAt: now, dashboardChange: { action: "mark-paid", at: now, before } },
  };
}

/** The fields each kind of action changes, so undo knows what to restore. */
const UNDO_FIELDS: Record<MoneyActionKind, (keyof MoneyChangeBefore)[]> = {
  subscription: ["status", "cancelledAt"],
  everyday: ["paid", "paidAt"],
  sell: ["stage", "soldAt", "paidAt"],
};

/**
 * Put back the values the last dashboard change replaced and drop the
 * change, so the next agent ingest is taken as sent again. One level only.
 */
function undoRow<T extends Subscription | EverydayTxn | SellListing>(
  kind: MoneyActionKind,
  row: T,
): RowResult<T> {
  const before = row.dashboardChange?.before;
  if (!row.dashboardChange || !before) return { error: "There is no dashboard change to undo on this row" };
  const next = { ...row } as Record<string, unknown>;
  for (const field of UNDO_FIELDS[kind]) {
    if (before[field] === undefined) delete next[field];
    else next[field] = before[field];
  }
  delete next.dashboardChange;
  return { changed: true, row: next as T };
}

function changeRow(
  req: MoneyActionRequest,
  row: Subscription | EverydayTxn | SellListing,
  now: string,
): RowResult<Subscription | EverydayTxn | SellListing> {
  if (req.action === "undo") return undoRow(req.kind, row);
  if (req.kind === "subscription") return cancelSubscription(row as Subscription, now);
  if (req.kind === "everyday") return markBillPaid(row as EverydayTxn, now);
  return changeSale(row as SellListing, req.action, now);
}

const COLLECTION: Record<MoneyActionKind, "subscriptions" | "everyday" | "sell"> = {
  subscription: "subscriptions",
  everyday: "everyday",
  sell: "sell",
};

/**
 * Apply one dashboard action to the stored overlay. Pure: the same inputs
 * give the same result, so `durableUpdateJson` may run it again.
 *
 * The row is looked up in what readers see (overlay plus seed). A changed
 * seed row is copied into the overlay. After a `replace` ingest with an
 * empty collection the seed rows are copied in whole, so the view does not
 * shrink to the one changed row. `next` is null when nothing needs writing.
 */
export function applyMoneyAction(
  overlay: MoneyOverlay,
  seed: MoneyCollections,
  req: MoneyActionRequest,
  now: string,
): { next: MoneyOverlay | null; outcome: MoneyActionOutcome } {
  const key = COLLECTION[req.kind];
  const overlayRows = overlay[key] as { id: string }[];
  const seedRows = seed[key] as { id: string }[];
  const visible = effectiveRows(overlayRows, seedRows, overlay.replaceAll);
  const current = visible.find((r) => r.id === req.id) as
    | Subscription
    | EverydayTxn
    | SellListing
    | undefined;
  if (!current) return { next: null, outcome: { status: "not-found" } };

  const result = changeRow(req, current, now);
  if ("error" in result) return { next: null, outcome: { status: "invalid", error: result.error } };
  if (!result.changed) return { next: null, outcome: { status: "unchanged", row: result.row } };

  const base = overlay.replaceAll && overlayRows.length === 0 ? seedRows : overlayRows;
  const rows = upsertById(base, [result.row]).slice(-MAX_MONEY_ROWS);
  return {
    next: { ...overlay, [key]: rows, updatedAt: now },
    outcome: { status: "changed", row: result.row },
  };
}

/* ------------------------------------------------------------------------ */
/* Ingest after a dashboard change                                          */
/* ------------------------------------------------------------------------ */

function withoutChange<T extends { dashboardChange?: unknown }>(row: T): T {
  if (row.dashboardChange !== null) return row;
  const copy = { ...row };
  delete copy.dashboardChange;
  return copy;
}

/**
 * An agent ingest row replaces the stored row by id. When the stored row
 * carries a dashboard change, the change survives a stale agent row:
 *
 * - cancel: the subscription stays cancelled.
 * - bill mark-paid: the bill stays paid while `due` is unchanged. A new
 *   `due` is a new billing cycle, so the agent's row wins.
 * - sale sold / mark-paid: the stage never moves backwards; a stage further
 *   along (shipped after sold) wins.
 *
 * An ingest row with `dashboardChange: null` always wins and clears it.
 */
export function keepSubscriptionChange(stored: Subscription | undefined, incoming: Subscription): Subscription {
  if (incoming.dashboardChange === null || !stored?.dashboardChange) return withoutChange(incoming);
  return {
    ...incoming,
    status: "cancelled",
    cancelledAt: stored.cancelledAt ?? incoming.cancelledAt,
    dashboardChange: stored.dashboardChange,
  };
}

export function keepEverydayChange(stored: EverydayTxn | undefined, incoming: EverydayTxn): EverydayTxn {
  if (incoming.dashboardChange === null || !stored?.dashboardChange) return withoutChange(incoming);
  const sameCycle = incoming.kind === "bill" && (incoming.due ?? "") === (stored.due ?? "");
  if (!sameCycle) {
    const fresh = { ...incoming };
    delete fresh.dashboardChange;
    return fresh;
  }
  return {
    ...incoming,
    paid: true,
    paidAt: stored.paidAt ?? incoming.paidAt,
    dashboardChange: stored.dashboardChange,
  };
}

export function keepSellChange(stored: SellListing | undefined, incoming: SellListing): SellListing {
  if (incoming.dashboardChange === null || !stored?.dashboardChange) return withoutChange(incoming);
  const agentAhead = STAGE_RANK[incoming.stage] >= STAGE_RANK[stored.stage] && incoming.stage !== "dead";
  return {
    ...incoming,
    stage: agentAhead ? incoming.stage : stored.stage,
    soldAt: incoming.soldAt ?? stored.soldAt,
    paidAt: incoming.paidAt ?? stored.paidAt,
    soldPrice: incoming.soldPrice ?? stored.soldPrice,
    dashboardChange: stored.dashboardChange,
  };
}

export function keepChanges<T extends { id: string }>(
  stored: T[],
  incoming: T[],
  keep: (stored: T | undefined, incoming: T) => T,
): T[] {
  const byId = new Map(stored.map((r) => [r.id, r]));
  return incoming.map((row) => keep(byId.get(row.id), row));
}
