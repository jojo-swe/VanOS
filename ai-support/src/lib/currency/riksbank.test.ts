import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { durableGetJson } from "@/lib/durable/store";
import { getMoneySnapshot } from "@/lib/money/store";
import {
  RIKSBANK_RETRY_MS,
  RIKSBANK_TTL_MS,
  fetchRiksbankRates,
  getRiksbankRates,
  parseRiksbankObservation,
  refreshRiksbankRates,
  resetRiksbankState,
  settleRiksbankRefresh,
} from "./riksbank";

// Real answers from GET https://api.riksbank.se/swea/v1/Observations/Latest/{series}
// (2026-10-17). Tests never touch the network.
const FIXTURE: Record<string, unknown> = {
  SEKUSDPMI: { date: "2026-10-16", value: 9.90403 },
  SEKEURPMI: { date: "2026-10-16", value: 11.145 },
};

const ENV_KEYS = [
  "VANOS_DEMO_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "MONEY_FX_AUTO",
  "MONEY_USD_SEK_RATE",
  "MONEY_EUR_SEK_RATE",
] as const;
const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];
const realFetch = globalThis.fetch;

let dataDir = "";
let n = 0;

type Answer = { status: number; body: unknown } | "throw";

/** A fetch that answers from FIXTURE (or `answers`) and records each URL. */
function fakeFetch(answers: Record<string, Answer> = {}) {
  const urls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const series = url.split("/").pop() ?? "";
    const answer = answers[series] ?? { status: 200, body: FIXTURE[series] ?? null };
    if (answer === "throw") throw new Error("network down");
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, urls };
}

const failing = () =>
  fakeFetch({ SEKUSDPMI: { status: 503, body: { message: "busy" } }, SEKEURPMI: "throw" });

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-riksbank-"));
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete env[key];
  // Local files are named by key alone, so each test gets its own folder.
  env.BOTS_DATA_DIR = path.join(dataDir, String(n));
  env.VANOS_STORE_PREFIX = `rb-test-${Date.now()}-${n++}`;
  resetRiksbankState();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  resetRiksbankState();
  await rm(dataDir, { recursive: true, force: true });
});

describe("parseRiksbankObservation", () => {
  test("reads the Observations/Latest shape", () => {
    assert.deepEqual(parseRiksbankObservation(FIXTURE.SEKUSDPMI), {
      date: "2026-10-16",
      value: 9.90403,
    });
  });

  test("rejects anything that is not a sane rate on a real day", () => {
    for (const bad of [
      null,
      [],
      "9.9",
      {},
      { date: "2026-10-16" },
      { value: 9.9 },
      { date: "2026-10-16", value: "9.9" },
      { date: "2026-10-16", value: 0 },
      { date: "2026-10-16", value: -1 },
      { date: "2026-10-16", value: 5000 },
      { date: "2026-10-16", value: Number.NaN },
      { date: "2026-02-30", value: 9.9 },
      { date: "16/10/2026", value: 9.9 },
      { date: "2026-10-16T00:00:00Z", value: 9.9 },
    ]) {
      assert.equal(parseRiksbankObservation(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("fetchRiksbankRates", () => {
  test("asks for the USD and EUR mid rates on api.riksbank.se only", async () => {
    const { impl, urls } = fakeFetch();
    const now = Date.parse("2026-10-17T08:00:00Z");
    const rates = await fetchRiksbankRates(impl, now);
    assert.deepEqual(rates, {
      usdToSek: 9.90403,
      eurToSek: 11.145,
      date: "2026-10-16",
      fetchedAt: "2026-10-17T08:00:00.000Z",
    });
    assert.deepEqual(urls.sort(), [
      "https://api.riksbank.se/swea/v1/Observations/Latest/SEKEURPMI",
      "https://api.riksbank.se/swea/v1/Observations/Latest/SEKUSDPMI",
    ]);
  });

  test("uses the older day when the two series differ", async () => {
    const { impl } = fakeFetch({ SEKEURPMI: { status: 200, body: { date: "2026-10-15", value: 11.1 } } });
    assert.equal((await fetchRiksbankRates(impl))?.date, "2026-10-15");
  });

  test("is null when either series fails or is garbage", async () => {
    assert.equal(await fetchRiksbankRates(failing().impl), null);
    const half = fakeFetch({ SEKEURPMI: { status: 200, body: { date: "2026-10-16", value: -3 } } });
    assert.equal(await fetchRiksbankRates(half.impl), null);
    const notFound = fakeFetch({ SEKUSDPMI: { status: 404, body: null } });
    assert.equal(await fetchRiksbankRates(notFound.impl), null);
  });
});

describe("getRiksbankRates cache", () => {
  test("never waits: first read is empty, then serves the stored rates within the TTL", async () => {
    const { impl, urls } = fakeFetch();
    const t0 = Date.parse("2026-10-17T08:00:00Z");
    assert.equal(await getRiksbankRates({ now: t0, fetchImpl: impl }), null);
    await settleRiksbankRefresh();
    assert.equal(urls.length, 2);

    const stored = await getRiksbankRates({ now: t0 + 60_000, fetchImpl: impl });
    assert.equal(stored?.usdToSek, 9.90403);
    assert.equal(stored?.date, "2026-10-16");
    const onDisk = await durableGetJson<{ eurToSek: number }>("fx-riksbank");
    assert.equal(onDisk?.eurToSek, 11.145);

    await getRiksbankRates({ now: t0 + RIKSBANK_TTL_MS - 1, fetchImpl: impl });
    await settleRiksbankRefresh();
    assert.equal(urls.length, 2, "no refetch inside the TTL");
  });

  test("keeps the last good rates when a refresh fails, and backs off", async () => {
    const t0 = Date.parse("2026-10-17T08:00:00Z");
    await refreshRiksbankRates(fakeFetch().impl, t0);

    const down = failing();
    const stale = t0 + RIKSBANK_TTL_MS + 1;
    const served = await getRiksbankRates({ now: stale, fetchImpl: down.impl });
    assert.equal(served?.usdToSek, 9.90403, "serves old rates while refreshing");
    await settleRiksbankRefresh();
    assert.equal(down.urls.length, 2);

    const after = await getRiksbankRates({ now: stale + 1_000, fetchImpl: down.impl });
    await settleRiksbankRefresh();
    assert.equal(after?.usdToSek, 9.90403, "last good rates kept");
    assert.equal(down.urls.length, 2, "no retry inside the back-off");

    const next = fakeFetch({ SEKUSDPMI: { status: 200, body: { date: "2026-10-17", value: 9.8 } } });
    await getRiksbankRates({ now: stale + RIKSBANK_RETRY_MS + 1_000, fetchImpl: next.impl });
    await settleRiksbankRefresh();
    assert.equal(next.urls.length, 2, "retries after the back-off");
    const fresh = await getRiksbankRates({ now: stale + RIKSBANK_RETRY_MS + 2_000, fetchImpl: next.impl });
    assert.equal(fresh?.usdToSek, 9.8);
  });

  test("ignores a malformed stored document", async () => {
    const { durableSetJson } = await import("@/lib/durable/store");
    await durableSetJson("fx-riksbank", { usdToSek: "lots", eurToSek: 11, date: "x", fetchedAt: "y" });
    const { impl, urls } = fakeFetch();
    assert.equal(await getRiksbankRates({ fetchImpl: impl }), null);
    await settleRiksbankRefresh();
    assert.equal(urls.length, 2);
  });

  test("never steps back to an older day", async () => {
    await refreshRiksbankRates(
      fakeFetch({
        SEKUSDPMI: { status: 200, body: { date: "2026-10-17", value: 9.7 } },
        SEKEURPMI: { status: 200, body: { date: "2026-10-17", value: 11.2 } },
      }).impl,
    );
    const rates = await refreshRiksbankRates(fakeFetch().impl);
    assert.equal(rates?.date, "2026-10-17");
    assert.equal(rates?.usdToSek, 9.7);
  });

  test("off in demo mode and with MONEY_FX_AUTO=off", async () => {
    for (const [key, value] of [
      ["VANOS_DEMO_MODE", "true"],
      ["MONEY_FX_AUTO", "off"],
      ["MONEY_FX_AUTO", "false"],
    ] as const) {
      resetRiksbankState();
      env[key] = value;
      const { impl, urls } = fakeFetch();
      assert.equal(await getRiksbankRates({ fetchImpl: impl }), null, `${key}=${value}`);
      assert.equal(await refreshRiksbankRates(impl), null, `${key}=${value}`);
      await settleRiksbankRefresh();
      assert.equal(urls.length, 0, `${key}=${value}: no request`);
      delete env[key];
    }
  });
});

describe("money snapshot with Riksbank rates", () => {
  test("uses stored Riksbank rates and says so", async () => {
    await refreshRiksbankRates(fakeFetch().impl);
    // Any background refresh from the snapshot read must not reach the network.
    globalThis.fetch = fakeFetch().impl;
    const snap = await getMoneySnapshot();
    assert.equal(snap.usdToSek, 9.90403);
    assert.equal(snap.eurToSek, 11.145);
    assert.equal(snap.fxSource, "riksbank");
    assert.equal(snap.riksbankDate, "2026-10-16");
    assert.equal(snap.fxSources, undefined);
  });

  test("an env pin still wins for its currency", async () => {
    await refreshRiksbankRates(fakeFetch().impl);
    globalThis.fetch = fakeFetch().impl;
    env.MONEY_USD_SEK_RATE = "10.1";
    const snap = await getMoneySnapshot();
    assert.equal(snap.usdToSek, 10.1);
    assert.equal(snap.eurToSek, 11.145);
    assert.equal(snap.fxSource, "env");
    assert.deepEqual(snap.fxSources, { usd: "env", eur: "riksbank" });
  });
});
