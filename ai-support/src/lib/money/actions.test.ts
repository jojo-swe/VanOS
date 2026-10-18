import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyMoneyAction,
  keepEverydayChange,
  keepSellChange,
  keepSubscriptionChange,
  parseMoneyAction,
} from "./actions";
import { emptyOverlay, type MoneyCollections } from "./overlay";
import { parseMoneyIngest } from "./parse-ingest";
import { mergeMoneyIngest } from "./store";
import type { EverydayTxn, SellListing, Subscription } from "./types";

const NOW = "2026-10-17T12:05:00.000Z";

const SUB: Subscription = {
  id: "sub-a",
  name: "Editor",
  provider: "Example",
  category: "ai",
  amount: 20,
  currency: "USD",
  cadence: "monthly",
  status: "active",
  nextBilling: "2026-10-29",
};

const BILL: EverydayTxn = {
  id: "ev-rent",
  kind: "bill",
  label: "Rent",
  amount: 8000,
  currency: "SEK",
  due: "2026-10-27",
  paid: false,
  recurring: true,
  category: "housing",
};

const INCOME: EverydayTxn = {
  id: "ev-pay",
  kind: "income",
  label: "Pay",
  amount: 20000,
  currency: "SEK",
  category: "work",
};

const LISTING: SellListing = {
  id: "sell-shelf",
  title: "Shelf",
  channel: "blocket",
  stage: "listed",
  askPrice: 1000,
  currency: "SEK",
  taxRelevant: false,
};

function seed(): MoneyCollections {
  return { subscriptions: [SUB], everyday: [BILL, INCOME], taxItems: [], sell: [LISTING] };
}

describe("parseMoneyAction", () => {
  test("accepts each action on its own kind", () => {
    for (const [kind, action] of [
      ["subscription", "cancel"],
      ["everyday", "mark-paid"],
      ["sell", "sold"],
      ["sell", "mark-paid"],
    ]) {
      const parsed = parseMoneyAction({ kind, id: "x", action });
      assert.equal(parsed.ok, true, `${kind} ${action}`);
    }
  });

  test("refuses an action that does not fit the kind", () => {
    const parsed = parseMoneyAction({ kind: "subscription", id: "x", action: "sold" });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /does not apply to subscription/);
    assert.equal(parseMoneyAction({ kind: "everyday", id: "x", action: "cancel" }).ok, false);
  });

  test("refuses unknown kinds, actions, fields and empty ids", () => {
    assert.equal(parseMoneyAction({ kind: "tax", id: "x", action: "mark-paid" }).ok, false);
    assert.equal(parseMoneyAction({ kind: "sell", id: "x", action: "delete" }).ok, false);
    assert.equal(parseMoneyAction({ kind: "sell", id: "  ", action: "sold" }).ok, false);
    assert.equal(parseMoneyAction({ kind: "sell", id: "x", action: "sold", extra: 1 }).ok, false);
    assert.equal(parseMoneyAction({ kind: "sell", id: 5, action: "sold" }).ok, false);
  });
});

describe("applyMoneyAction", () => {
  test("marks a seed bill paid and copies it into the overlay", () => {
    const { next, outcome } = applyMoneyAction(
      emptyOverlay(),
      seed(),
      { kind: "everyday", id: "ev-rent", action: "mark-paid" },
      NOW,
    );
    assert.equal(outcome.status, "changed");
    assert.ok(next);
    assert.equal(next.everyday.length, 1);
    assert.deepEqual(next.everyday[0], {
      ...BILL,
      paid: true,
      paidAt: NOW,
      dashboardChange: { action: "mark-paid", at: NOW, before: { paid: false, paidAt: undefined } },
    });
  });

  test("is pure: the same input gives the same result and leaves the input alone", () => {
    const overlay = emptyOverlay();
    const before = JSON.stringify(overlay);
    const req = { kind: "subscription", id: "sub-a", action: "cancel" } as const;
    const a = applyMoneyAction(overlay, seed(), req, NOW);
    const b = applyMoneyAction(overlay, seed(), req, NOW);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(overlay), before);
  });

  test("cancels a subscription", () => {
    const { next, outcome } = applyMoneyAction(
      emptyOverlay(),
      seed(),
      { kind: "subscription", id: "sub-a", action: "cancel" },
      NOW,
    );
    assert.equal(outcome.status, "changed");
    const row = next?.subscriptions[0];
    assert.equal(row?.status, "cancelled");
    assert.equal(row?.cancelledAt, NOW);
  });

  test("sold, then mark-paid, walks a listing forward", () => {
    const sold = applyMoneyAction(emptyOverlay(), seed(), { kind: "sell", id: "sell-shelf", action: "sold" }, NOW);
    assert.equal(sold.outcome.status, "changed");
    assert.ok(sold.next);
    assert.equal(sold.next.sell[0]?.stage, "sold");
    assert.equal(sold.next.sell[0]?.soldAt, "2026-10-17");

    const paid = applyMoneyAction(sold.next, seed(), { kind: "sell", id: "sell-shelf", action: "mark-paid" }, NOW);
    assert.equal(paid.outcome.status, "changed");
    assert.equal(paid.next?.sell[0]?.stage, "paid");
    assert.equal(paid.next?.sell[0]?.paidAt, NOW);
    assert.equal(paid.next?.sell[0]?.soldAt, "2026-10-17");
  });

  test("repeating an action is a no-op with nothing to write", () => {
    const first = applyMoneyAction(emptyOverlay(), seed(), { kind: "everyday", id: "ev-rent", action: "mark-paid" }, NOW);
    assert.ok(first.next);
    const again = applyMoneyAction(first.next, seed(), { kind: "everyday", id: "ev-rent", action: "mark-paid" }, NOW);
    assert.equal(again.outcome.status, "unchanged");
    assert.equal(again.next, null);
  });

  test("unknown id is not-found; a non-bill cannot be marked paid", () => {
    const missing = applyMoneyAction(emptyOverlay(), seed(), { kind: "sell", id: "nope", action: "sold" }, NOW);
    assert.equal(missing.outcome.status, "not-found");
    assert.equal(missing.next, null);

    const income = applyMoneyAction(emptyOverlay(), seed(), { kind: "everyday", id: "ev-pay", action: "mark-paid" }, NOW);
    assert.equal(income.outcome.status, "invalid");
    assert.equal(income.next, null);
  });

  test("after a replace ingest with an empty collection, the seed view is kept", () => {
    const overlay = { ...emptyOverlay(), replaceAll: true };
    const { next } = applyMoneyAction(overlay, seed(), { kind: "everyday", id: "ev-rent", action: "mark-paid" }, NOW);
    assert.equal(next?.everyday.length, 2);
    assert.equal(next?.everyday.find((r) => r.id === "ev-rent")?.paid, true);
  });
});

describe("undo", () => {
  test("undo restores a bill, a subscription and a sale exactly", () => {
    const paid = applyMoneyAction(emptyOverlay(), seed(), { kind: "everyday", id: "ev-rent", action: "mark-paid" }, NOW);
    assert.ok(paid.next);
    const undone = applyMoneyAction(paid.next, seed(), { kind: "everyday", id: "ev-rent", action: "undo" }, NOW);
    assert.equal(undone.outcome.status, "changed");
    assert.deepEqual(undone.next?.everyday[0], BILL);

    const cancelled = applyMoneyAction(emptyOverlay(), seed(), { kind: "subscription", id: "sub-a", action: "cancel" }, NOW);
    assert.ok(cancelled.next);
    const back = applyMoneyAction(cancelled.next, seed(), { kind: "subscription", id: "sub-a", action: "undo" }, NOW);
    assert.deepEqual(back.next?.subscriptions[0], SUB);

    const sold = applyMoneyAction(emptyOverlay(), seed(), { kind: "sell", id: "sell-shelf", action: "sold" }, NOW);
    assert.ok(sold.next);
    const relisted = applyMoneyAction(sold.next, seed(), { kind: "sell", id: "sell-shelf", action: "undo" }, NOW);
    assert.deepEqual(relisted.next?.sell[0], LISTING);
  });

  test("undo goes back one step and survives a JSON round trip", () => {
    const sold = applyMoneyAction(emptyOverlay(), seed(), { kind: "sell", id: "sell-shelf", action: "sold" }, NOW);
    assert.ok(sold.next);
    const paid = applyMoneyAction(sold.next, seed(), { kind: "sell", id: "sell-shelf", action: "mark-paid" }, NOW);
    assert.ok(paid.next);
    const stored = JSON.parse(JSON.stringify(paid.next));
    const undone = applyMoneyAction(stored, seed(), { kind: "sell", id: "sell-shelf", action: "undo" }, NOW);
    const row = undone.next?.sell[0];
    assert.equal(row?.stage, "sold");
    assert.equal(row?.soldAt, "2026-10-17");
    assert.equal(row?.paidAt, undefined);
    assert.equal(row?.dashboardChange, undefined);
  });

  test("undo on an untouched row is invalid and writes nothing", () => {
    const res = applyMoneyAction(emptyOverlay(), seed(), { kind: "everyday", id: "ev-rent", action: "undo" }, NOW);
    assert.equal(res.outcome.status, "invalid");
    assert.equal(res.next, null);
    assert.equal(parseMoneyAction({ kind: "sell", id: "x", action: "undo" }).ok, true);
  });

  test("ingest keeps the before values, so undo still works after an agent update", () => {
    const parsed = parseMoneyIngest({
      everyday: [
        {
          ...BILL,
          paid: true,
          dashboardChange: { action: "mark-paid", at: NOW, before: { paid: false } },
        },
      ],
    });
    assert.ok(parsed.ok);
    if (parsed.ok) assert.deepEqual(parsed.payload.everyday?.[0].dashboardChange?.before, { paid: false });
  });
});

describe("agent ingest after a dashboard change", () => {
  const paidBill: EverydayTxn = {
    ...BILL,
    paid: true,
    paidAt: NOW,
    dashboardChange: { action: "mark-paid", at: NOW },
  };

  test("a stale bill row keeps the paid mark; a new due date starts a new cycle", () => {
    const stale = keepEverydayChange(paidBill, { ...BILL });
    assert.equal(stale.paid, true);
    assert.equal(stale.paidAt, NOW);
    assert.deepEqual(stale.dashboardChange, paidBill.dashboardChange);

    const next = keepEverydayChange(paidBill, { ...BILL, due: "2026-11-27" });
    assert.equal(next.paid, false);
    assert.equal(next.dashboardChange, undefined);
  });

  test("dashboardChange: null lets the agent's row win", () => {
    const row = keepEverydayChange(paidBill, { ...BILL, dashboardChange: null });
    assert.equal(row.paid, false);
    assert.equal("dashboardChange" in row, false);
  });

  test("a cancelled subscription stays cancelled", () => {
    const stored: Subscription = {
      ...SUB,
      status: "cancelled",
      cancelledAt: NOW,
      dashboardChange: { action: "cancel", at: NOW },
    };
    const row = keepSubscriptionChange(stored, { ...SUB, amount: 25 });
    assert.equal(row.status, "cancelled");
    assert.equal(row.amount, 25);
    assert.equal(keepSubscriptionChange(stored, { ...SUB, dashboardChange: null }).status, "active");
  });

  test("a sale never moves backwards, but can move forward", () => {
    const stored: SellListing = {
      ...LISTING,
      stage: "sold",
      soldAt: "2026-10-17",
      dashboardChange: { action: "sold", at: NOW },
    };
    assert.equal(keepSellChange(stored, { ...LISTING }).stage, "sold");
    assert.equal(keepSellChange(stored, { ...LISTING, stage: "dead" }).stage, "sold");
    const shipped = keepSellChange(stored, { ...LISTING, stage: "shipped" });
    assert.equal(shipped.stage, "shipped");
    assert.equal(shipped.soldAt, "2026-10-17");
  });

  test("mergeMoneyIngest applies the rules on upsert and on replace", () => {
    for (const replace of [false, true]) {
      const overlay = { ...emptyOverlay(), everyday: [paidBill] };
      const parsed = parseMoneyIngest({ replace, everyday: [{ ...BILL }, INCOME] });
      assert.ok(parsed.ok);
      mergeMoneyIngest(overlay, parsed.payload);
      const bill = overlay.everyday.find((r) => r.id === "ev-rent");
      assert.equal(bill?.paid, true, `replace=${replace}`);
      assert.equal(overlay.everyday.length, 2);
    }
  });
});
