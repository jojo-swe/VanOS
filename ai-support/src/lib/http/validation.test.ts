import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { POST as costsIngest } from "@/app/api/costs/ingest/route";
import { POST as v1Ingest } from "@/app/api/v1/ingest/route";
import { POST as v1Sync } from "@/app/api/v1/sync/route";
import { getConnectionsOverlay, getConnectionsSnapshot } from "@/lib/connections/store";
import { getCostSnapshot } from "@/lib/costs/store";
import { durableSetJson } from "@/lib/durable/store";
import { getMoneySnapshot } from "@/lib/money/store";
import { parseMoneyIngest } from "@/lib/money/parse-ingest";
import { clearRateLimits } from "@/lib/security/rate-limit";

const AGENT = "a".repeat(32);
const INGEST = "c".repeat(32);
const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_DEMO_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AGENT_API_TOKEN",
  "AGENT_API_TOKEN_PREVIOUS",
  "BOTS_INGEST_SECRET",
  "BOTS_INGEST_SECRET_PREVIOUS",
  "VANOS_ALLOW_INGEST_AS_AGENT",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

let dataDir = "";
let run = 0;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-validation-"));
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearRateLimits();
});

/** Fresh store namespace per test, production auth, no Upstash. */
function setup() {
  env.NODE_ENV = "production";
  delete env.VANOS_DEMO_MODE;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.VANOS_ALLOW_INGEST_AS_AGENT;
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  env.VANOS_STORE_PREFIX = `validation-${Date.now()}-${run++}`;
  env.AGENT_API_TOKEN = AGENT;
  env.BOTS_INGEST_SECRET = INGEST;
}

function post(url: string, body: unknown, token = AGENT): Request {
  return new Request(`http://127.0.0.1:3000${url}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const LINE = { name: "Model", provider: "x", category: "llm", amountUsd: 2 };

describe("costs", () => {
  test("bad series points are skipped and the panel still loads", async () => {
    setup();
    const res = await v1Ingest(
      post("/api/v1/ingest", { domain: "costs", lines: [LINE], series: [{}, { date: "2026-10-01", llm: 1 }] }),
    );
    assert.equal(res.status, 200);
    const snap = await getCostSnapshot();
    assert.ok(snap.series.some((p) => p.date === "2026-10-01"));
    assert.ok(snap.series.every((p) => typeof p.date === "string"));
  });

  test("an invalid budget is refused", async () => {
    setup();
    const res = await v1Ingest(post("/api/v1/ingest", { domain: "costs", lines: [LINE], budget: { dailyUsd: "lots" } }));
    assert.equal(res.status, 400);
    const zero = await v1Ingest(post("/api/v1/ingest", { domain: "costs", lines: [LINE], budget: { dailyUsd: 0 } }));
    assert.equal(zero.status, 400);
  });

  test("bad data already in storage cannot break reads", async () => {
    setup();
    await durableSetJson("cost-overlay", {
      updatedAt: new Date().toISOString(),
      lines: [{ junk: true }, { ...LINE, id: "ok", period: "day", status: "ok", lastUpdated: "x", source: "ingest" }],
      series: [{}, null, { date: 5 }],
      budget: { dailyUsd: "x" },
    });
    const snap = await getCostSnapshot();
    assert.ok(snap.lines.some((l) => l.id === "ok"));
    assert.ok(snap.series.every((p) => typeof p.date === "string"));
    assert.equal(typeof snap.budget.dailyUsd, "number");
  });

  test("bodies over the cap get 413 before parsing", async () => {
    setup();
    const big = JSON.stringify({ lines: [{ ...LINE, note: "x".repeat(70 * 1024) }] });
    const res = await costsIngest(post("/api/costs/ingest", big, INGEST));
    assert.equal(res.status, 413);
  });
});

describe("connections", () => {
  test("a wrong-typed section is refused", async () => {
    setup();
    const res = await v1Ingest(post("/api/v1/ingest", { domain: "connections", github: { repos: {} } }));
    assert.equal(res.status, 400);
  });

  test("bad data already in storage cannot break reads", async () => {
    setup();
    await durableSetJson("connections-overlay", {
      updatedAt: new Date().toISOString(),
      github: { repos: {} },
      mail: "nope",
    });
    const snap = await getConnectionsSnapshot();
    assert.ok(Array.isArray(snap.github.repos));
  });

  test("replace applies to one ingest, not every later one", async () => {
    setup();
    const first = await v1Ingest(
      post("/api/v1/ingest", { domain: "connections", replace: true, mail: { unread: 3, threads: [] } }),
    );
    assert.equal(first.status, 200);
    const second = await v1Ingest(post("/api/v1/ingest", { domain: "connections", mail: { important: 1 } }));
    assert.equal(second.status, 200);
    const overlay = await getConnectionsOverlay();
    assert.equal(overlay.mail?.unread, 3);
    assert.equal(overlay.mail?.important, 1);
  });
});

describe("money", () => {
  test("rows without a numeric amount are dropped, defaults fill the rest", async () => {
    const parsed = parseMoneyIngest({
      subscriptions: [
        { id: "a", name: "A", amount: "10" },
        { id: "b", name: "B", amount: 10 },
      ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.payload.subscriptions?.length, 1);
    assert.equal(parsed.payload.subscriptions?.[0]?.currency, "SEK");
    assert.equal(parsed.payload.subscriptions?.[0]?.cadence, "monthly");
  });

  test("bad rows already in storage cannot break reads", async () => {
    setup();
    await durableSetJson("money-overlay", {
      updatedAt: new Date().toISOString(),
      subscriptions: [{ id: "x" }],
      everyday: "nope",
    });
    const snap = await getMoneySnapshot();
    assert.ok(Array.isArray(snap.everyday));
    assert.ok(snap.subscriptions.every((s) => typeof s.amount === "number"));
  });
});

describe("bot events outside /api/bots/ingest", () => {
  test("/api/v1/ingest bots uses the strict schema and the per-bot limit", async () => {
    setup();
    const unknown = await v1Ingest(post("/api/v1/ingest", { domain: "bots", botId: "muddy", summary: "hi", evil: 1 }));
    assert.equal(unknown.status, 400);
    const badId = await v1Ingest(post("/api/v1/ingest", { domain: "bots", botId: "../x", summary: "hi" }));
    assert.equal(badId.status, 400);
    const big = await v1Ingest(
      post("/api/v1/ingest", { domain: "bots", botId: "muddy", summary: "x", data: { blob: "y".repeat(40 * 1024) } }),
    );
    assert.equal(big.status, 413);

    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await v1Ingest(post("/api/v1/ingest", { domain: "bots", botId: "limited", summary: `n${i}` }))).status;
    }
    assert.equal(last, 429);
  });

  test("/api/v1/sync validates each domain and reports what it refused", async () => {
    setup();
    const res = await v1Sync(
      post("/api/v1/sync", {
        source: "manual",
        domains: {
          bots: { botId: "muddy", summary: "ok", sneaky: true },
          costs: { lines: [LINE], budget: { dailyUsd: -1 } },
          money: { usdToSek: 10.5 },
        },
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      digest: { domainsApplied: string[]; domainErrors?: Record<string, string> };
    };
    assert.deepEqual(body.digest.domainsApplied, ["money"]);
    assert.ok(body.digest.domainErrors?.bots);
    assert.ok(body.digest.domainErrors?.costs);
  });
});
