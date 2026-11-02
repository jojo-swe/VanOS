import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot } from "./compute";
import { parseMoneyIngest } from "./parse-ingest";
import { describeFxRates, formatCurrency } from "@/lib/currency/fx";
import { emptyOverlay, normalizeOverlay } from "./overlay";
import { defaultFx } from "./seed";
import { mergeMoneyIngest, moneyFx } from "./store";

test("euro rows use eurToSek, not a guess from the dollar rate", () => {
  const snap = buildSnapshot({
    updatedAt: "2026-10-17T00:00:00Z",
    fx: { usdToSek: 10, eurToSek: 12, source: "agent" },
    subscriptions: [
      {
        id: "s1",
        name: "Tool",
        amount: 10,
        currency: "EUR",
        cadence: "monthly",
        status: "active",
        category: "ai",
      } as never,
    ],
    everyday: [],
    taxItems: [],
    sell: [],
  });
  assert.equal(snap.subMonthlySek, 120);
  assert.equal(snap.eurToSek, 12);
  assert.equal(snap.fxSource, "agent");
});

test("money ingest accepts exchange rates alone", () => {
  const parsed = parseMoneyIngest({ usdToSek: 10.4, eurToSek: 11.3 });
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.payload.eurToSek, 11.3);
  assert.equal(parseMoneyIngest({ eurToSek: -1 }).ok, false);
  assert.equal(parseMoneyIngest({ eurToSek: "11" }).ok, false);
});

function withRateEnv(usd: string | undefined, eur: string | undefined, fn: () => void) {
  const prevUsd = process.env.MONEY_USD_SEK_RATE;
  const prevEur = process.env.MONEY_EUR_SEK_RATE;
  try {
    if (usd === undefined) delete process.env.MONEY_USD_SEK_RATE;
    else process.env.MONEY_USD_SEK_RATE = usd;
    if (eur === undefined) delete process.env.MONEY_EUR_SEK_RATE;
    else process.env.MONEY_EUR_SEK_RATE = eur;
    fn();
  } finally {
    if (prevUsd === undefined) delete process.env.MONEY_USD_SEK_RATE;
    else process.env.MONEY_USD_SEK_RATE = prevUsd;
    if (prevEur === undefined) delete process.env.MONEY_EUR_SEK_RATE;
    else process.env.MONEY_EUR_SEK_RATE = prevEur;
  }
}

const RIKSBANK = {
  usdToSek: 9.9,
  eurToSek: 11.15,
  date: "2026-10-16",
  fetchedAt: "2026-10-17T06:00:00.000Z",
};

test("defaultFx: env pins, else built-in defaults", () => {
  withRateEnv(undefined, undefined, () => {
    assert.equal(defaultFx().source, "default");
  });
  withRateEnv(undefined, "11.9", () => {
    assert.deepEqual(defaultFx(), { usdToSek: 10.5, eurToSek: 11.9, source: "env" });
  });
});

test("env pins win per currency over agent and Riksbank rates", () => {
  withRateEnv(undefined, "11.9", () => {
    const fx = moneyFx(
      { usdToSek: 10.2, eurToSek: 11.2, usdToSekAt: "2026-10-17T09:00:00Z", eurToSekAt: "2026-10-17T09:00:00Z" },
      RIKSBANK,
    );
    assert.deepEqual(fx, {
      usdToSek: 10.2,
      eurToSek: 11.9,
      source: "env",
      sources: { usd: "agent", eur: "env" },
    });
  });
});

test("the newer of agent and Riksbank rates wins", () => {
  withRateEnv(undefined, undefined, () => {
    // Sent the morning after Riksbanken's day: the agent wins.
    const nextDay = moneyFx(
      { usdToSek: 10.2, eurToSek: 11.2, usdToSekAt: "2026-10-17T09:00:00Z", eurToSekAt: "2026-10-17T09:00:00Z" },
      RIKSBANK,
    );
    assert.deepEqual(nextDay, { usdToSek: 10.2, eurToSek: 11.2, source: "agent" });

    // Sent on Riksbanken's day or earlier: Riksbanken wins.
    const sameDay = moneyFx(
      { usdToSek: 10.2, eurToSek: 11.2, usdToSekAt: "2026-10-16T20:00:00Z", eurToSekAt: "2026-10-15T09:00:00Z" },
      RIKSBANK,
    );
    assert.deepEqual(sameDay, {
      usdToSek: 9.9,
      eurToSek: 11.15,
      source: "riksbank",
      riksbankDate: "2026-10-16",
    });

    // Mixed: a fresh agent EUR rate, an old agent USD rate.
    const mixed = moneyFx(
      { usdToSek: 10.2, eurToSek: 11.2, usdToSekAt: "2026-10-10T09:00:00Z", eurToSekAt: "2026-10-18T09:00:00Z" },
      RIKSBANK,
    );
    assert.deepEqual(mixed, {
      usdToSek: 9.9,
      eurToSek: 11.2,
      source: "agent",
      sources: { usd: "riksbank", eur: "agent" },
      riksbankDate: "2026-10-16",
    });
  });
});

test("an agent rate stored without a time counts as older than Riksbanken", () => {
  withRateEnv(undefined, undefined, () => {
    assert.equal(moneyFx({ usdToSek: 10.2 }, RIKSBANK).source, "riksbank");
    // With no Riksbank rates it still applies.
    assert.deepEqual(moneyFx({ eurToSek: 11.2 }), {
      usdToSek: 10.5,
      eurToSek: 11.2,
      source: "agent",
      sources: { usd: "default", eur: "agent" },
    });
  });
});

test("defaults when nothing else is set", () => {
  withRateEnv(undefined, undefined, () => {
    assert.deepEqual(moneyFx({}, null), { usdToSek: 10.5, eurToSek: 11.5, source: "default" });
  });
});

test("money ingest records when each rate was sent", () => {
  const overlay = emptyOverlay();
  mergeMoneyIngest(overlay, { eurToSek: 11.3 }, "2026-10-17T10:00:00.000Z");
  assert.equal(overlay.eurToSek, 11.3);
  assert.equal(overlay.eurToSekAt, "2026-10-17T10:00:00.000Z");
  assert.equal(overlay.usdToSekAt, undefined);
  const roundTrip = normalizeOverlay(JSON.parse(JSON.stringify(overlay)));
  assert.equal(roundTrip.eurToSekAt, "2026-10-17T10:00:00.000Z");
  assert.equal(normalizeOverlay({ ...overlay, usdToSekAt: "not a time" }).usdToSekAt, undefined);
});

test("the Money panel names the source and the Riksbank day", () => {
  assert.equal(
    describeFxRates({ usdToSek: 9.9, eurToSek: 11.15, source: "riksbank", riksbankDate: "2026-10-16" }),
    `Rates: 1 USD = ${formatCurrency(9.9, "SEK", 2)} · 1 EUR = ${formatCurrency(11.15, "SEK", 2)} (from Riksbanken, 2026-10-16)`,
  );
  const mixed = describeFxRates({
    usdToSek: 10.1,
    eurToSek: 11.15,
    source: "env",
    sources: { usd: "env", eur: "riksbank" },
    riksbankDate: "2026-10-16",
  });
  assert.match(mixed, /\(from settings\) · 1 EUR = .* \(from Riksbanken, 2026-10-16\)$/);
  assert.match(describeFxRates({ usdToSek: 10.5, eurToSek: 11.5 }), /\(default\)$/);
});
