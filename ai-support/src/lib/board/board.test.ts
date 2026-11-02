import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { POST as ingestPost } from "@/app/api/v1/ingest/route";
import { getConnectionsSnapshot } from "@/lib/connections/store";
import { getCostSnapshot } from "@/lib/costs/store";
import { getDashboardData, liveDashboardBase } from "@/lib/dashboard/data";
import { getMoneySnapshot } from "@/lib/money/store";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { parseBoardIngest } from "./parse-ingest";
import { mergeBoardIngest, normalizeBoard } from "./store";

const AGENT = "a".repeat(32);
const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_DEMO_MODE",
  "VANOS_ACCESS_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AGENT_API_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NOTION_TOKEN",
  "SLACK_WEBHOOK_URL",
  "SLACK_BOT_TOKEN",
  "HOME_ASSISTANT_URL",
  "HOME_ASSISTANT_TOKEN",
  "DISPLAYFUSION_BRIDGE_URL",
  "DISPLAYFUSION_BRIDGE_SECRET",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

let dataDir = "";
let run = 0;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-board-"));
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

/** Production, a fresh local store, no integrations configured. */
function setup() {
  for (const key of ENV_KEYS) delete env[key];
  env.NODE_ENV = "production";
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  env.VANOS_STORE_PREFIX = `board-${Date.now()}-${run++}`;
  env.AGENT_API_TOKEN = AGENT;
}

function ingest(body: unknown) {
  return ingestPost(
    new Request("http://127.0.0.1:3000/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${AGENT}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("board ingest parsing", () => {
  test("needs at least one section and rejects unknown fields", () => {
    assert.equal(parseBoardIngest({ reportedBy: "muddy" }).ok, false);
    assert.equal(parseBoardIngest({ content: [], surprise: 1 }).ok, false);
    assert.equal(parseBoardIngest({ vanlifeProgress: 140 }).ok, false);
    assert.equal(parseBoardIngest({ vanlifeProgress: 14 }).ok, true);
  });

  test("bad rows in a list are skipped, good ones kept", () => {
    const parsed = parseBoardIngest({
      content: [{ id: "c1", title: "Launch post" }, { id: "c2" }, "junk"],
    });
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.equal(parsed.payload.content?.length, 1);
      assert.equal(parsed.payload.content?.[0].stage, "idea");
    }
  });
});

describe("board merge", () => {
  test("lists replace their section, agent rows update by id", () => {
    const now = "2026-10-17T12:00:00.000Z";
    let board = normalizeBoard(null);
    const first = parseBoardIngest({
      agents: [{ id: "muddy", status: "ok", focus: "Standup" }],
      content: [{ id: "c1", title: "One" }, { id: "c2", title: "Two" }],
    });
    assert.ok(first.ok);
    if (!first.ok) return;
    board = mergeBoardIngest(board, first.payload, now);
    const second = parseBoardIngest({
      agents: [{ id: "elon", status: "warn" }],
      content: [{ id: "c3", title: "Three" }],
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    board = mergeBoardIngest(board, second.payload, now);
    assert.deepEqual(
      board.agents.map((a) => a.id),
      ["muddy", "elon"],
    );
    assert.equal(board.agents[0].lastActive, now);
    assert.deepEqual(
      board.content?.map((c) => c.id),
      ["c3"],
    );
  });

  test("normalizeBoard drops malformed stored data", () => {
    const board = normalizeBoard({
      updatedAt: "x",
      agents: [{ id: "a", status: "nope" }] as never,
      income: [{ id: "i1", name: "Shop", mrr: "lots" }] as never,
      vanlifeProgress: 500,
    });
    assert.equal(board.agents.length, 0);
    assert.equal(board.income?.length, 0);
    assert.equal(board.vanlifeProgress, undefined);
  });
});

describe("production shows no sample data", { concurrency: false }, () => {
  test("an unreported dashboard has the roster but no made-up sections", async () => {
    setup();
    const data = await getDashboardData();
    assert.ok(data.agents.length > 0);
    assert.ok(data.agents.every((a) => a.status === "idle" && a.lastActive === "No report yet"));
    for (const key of ["crons", "content", "social", "income", "life", "kpis", "schedule", "integrations"] as const) {
      assert.equal(data[key].length, 0, key);
    }
    assert.equal(data.mission.vanlifeProgress, undefined);
    assert.ok(!data.pulse.some((p) => p.id === "content-out" || p.id === "focus"));
    assert.ok(!data.alerts.some((a) => a.severity === "error"));
    assert.doesNotMatch(JSON.stringify(data), /Sample|Radar intel|Fictional/i);
  });

  test("money, connections and costs start without sample rows", async () => {
    setup();
    const [money, connections, costs] = await Promise.all([
      getMoneySnapshot(),
      getConnectionsSnapshot(),
      getCostSnapshot(),
    ]);
    assert.equal(money.subscriptions.length + money.everyday.length + money.sell.length, 0);
    assert.ok(money.alerts.some((a) => a.id === "money-empty" && a.severity === "idle"));
    assert.equal(connections.mail.threads.length, 0);
    assert.equal(connections.github.repos.length, 0);
    assert.doesNotMatch(JSON.stringify(connections), /Sample/);
    assert.ok(connections.connections.some((c) => c.name === "Gmail"));
    assert.ok(!connections.alerts.some((a) => a.severity === "warn" || a.severity === "error"));
    assert.equal(costs.series.length, 0);
    assert.ok(!costs.alerts.some((a) => /sample/i.test(a.title)));
  });

  test("a board ingest shows up on the dashboard", async () => {
    setup();
    const res = await ingest({
      domain: "board",
      reportedBy: "muddy",
      agents: [{ id: "muddy", status: "warn", focus: "Waiting on a decision" }],
      income: [{ id: "shop", name: "Shop", mrr: 49, currency: "USD", status: "ok" }],
      vanlifeProgress: 20,
    });
    assert.equal(res.status, 200);
    const data = await getDashboardData();
    const muddy = data.agents.find((a) => a.id === "muddy");
    assert.equal(muddy?.status, "warn");
    assert.equal(muddy?.focus, "Waiting on a decision");
    assert.equal(data.income.length, 1);
    assert.equal(data.mission.vanlifeProgress, 20);
    const mrr = data.pulse.find((p) => p.id === "mrr");
    assert.equal(mrr?.money?.value, 49);
    assert.equal(mrr?.status, "ok");
  });

  test("a bad board ingest is 400 and demo refuses writes", async () => {
    setup();
    assert.equal((await ingest({ domain: "board", nothing: true })).status, 400);
    env.VANOS_DEMO_MODE = "true";
    assert.equal((await ingest({ domain: "board", vanlifeProgress: 5 })).status, 403);
  });

  test("liveDashboardBase lists agents that report but are not on the roster", () => {
    const data = liveDashboardBase({
      updatedAt: "",
      agents: [{ id: "newbie", status: "ok", lastActive: new Date().toISOString() }],
    });
    assert.equal(data.agents.at(-1)?.id, "newbie");
    assert.equal(data.agents.at(-1)?.lastActive, "just now");
  });
});
