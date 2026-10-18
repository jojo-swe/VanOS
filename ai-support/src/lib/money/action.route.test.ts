import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { POST as actionPost } from "@/app/api/money/action/route";
import { POST as ingestPost } from "@/app/api/money/ingest/route";
import { GET as moneyGet } from "@/app/api/money/route";
import { demoMoneyParts } from "@/lib/demo/fixture";
import { applyMoneyIngest, getMoneySnapshot } from "@/lib/money/store";
import { clearRateLimits } from "@/lib/security/rate-limit";

const USER = "jojo";
const PASS = "p".repeat(32);
const BASIC = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const AGENT = "a".repeat(32);
const INGEST = "c".repeat(32);
const ORIGIN = "http://127.0.0.1:3000";

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_DEMO_MODE",
  "VANOS_ACCESS_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "AGENT_API_TOKEN",
  "BOTS_INGEST_SECRET",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

let dataDir = "";
let run = 0;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-money-action-"));
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

/**
 * Production auth, a fresh local store namespace, no Upstash, and the
 * sample rows stored the way an agent would send them (production has no
 * built-in rows).
 */
async function setup() {
  env.NODE_ENV = "production";
  delete env.VANOS_DEMO_MODE;
  delete env.VANOS_ACCESS_MODE;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.VANOS_TOTP_SECRET;
  delete env.VANOS_SESSION_SECRET;
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  env.VANOS_STORE_PREFIX = `money-action-${Date.now()}-${run++}`;
  env.DASHBOARD_BASIC_USER = USER;
  env.DASHBOARD_BASIC_PASSWORD = PASS;
  env.AGENT_API_TOKEN = AGENT;
  env.BOTS_INGEST_SECRET = INGEST;
  await applyMoneyIngest(demoMoneyParts());
}

const SAME_ORIGIN = {
  authorization: BASIC,
  "content-type": "application/json",
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
};

function action(body: unknown, headers: Record<string, string> = SAME_ORIGIN) {
  return actionPost(
    new Request(`${ORIGIN}/api/money/action`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/money/action", { concurrency: false }, () => {
  test("demo mode refuses before anything else", async () => {
    await setup();
    env.VANOS_DEMO_MODE = "true";
    const res = await action({ kind: "everyday", id: "ev-rent", action: "mark-paid" });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { demo?: boolean };
    assert.equal(body.demo, true);
  });

  test("needs dashboard auth and a same-origin JSON request", async () => {
    await setup();
    const body = { kind: "everyday", id: "ev-rent", action: "mark-paid" };
    const noAuth = await action(body, { "content-type": "application/json" });
    assert.equal(noAuth.status, 401);

    const crossSite = await action(body, { ...SAME_ORIGIN, origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    assert.equal(crossSite.status, 403);

    const form = await action(body, { ...SAME_ORIGIN, "content-type": "text/plain" });
    assert.equal(form.status, 403);

    const agent = await action(body, { authorization: `Bearer ${AGENT}`, "content-type": "application/json" });
    assert.equal(agent.status, 200);
  });

  test("bad bodies are 400 or 413", async () => {
    await setup();
    assert.equal((await action("{nope")).status, 400);
    assert.equal((await action({ kind: "everyday", id: "ev-rent" })).status, 400);
    const wrongKind = await action({ kind: "subscription", id: "sub-video", action: "mark-paid" });
    assert.equal(wrongKind.status, 400);
    const notBill = await action({ kind: "everyday", id: "ev-stipend", action: "mark-paid" });
    assert.equal(notBill.status, 400);
    const big = await action({ kind: "everyday", id: "x".repeat(3000), action: "mark-paid" });
    assert.equal(big.status, 413);
  });

  test("unknown id is 404 and writes nothing", async () => {
    await setup();
    const res = await action({ kind: "sell", id: "no-such-item", action: "sold" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /No item for sale/);
  });

  test("mark paid lands, shows on the next read, and repeats as a no-op", async () => {
    await setup();
    const before = await getMoneySnapshot();
    const unpaidSoon = before.everydaySummary.billsDueSoon;

    const res = await action({ kind: "everyday", id: "ev-phone", action: "mark-paid" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; changed: boolean; row: { paid: boolean; paidAt: string } };
    assert.equal(body.ok, true);
    assert.equal(body.changed, true);
    assert.equal(body.row.paid, true);
    assert.ok(body.row.paidAt);

    const snap = await getMoneySnapshot();
    const phone = snap.everyday.find((r) => r.id === "ev-phone");
    assert.equal(phone?.paid, true);
    assert.equal(phone?.dashboardChange?.action, "mark-paid");
    assert.equal(snap.everydaySummary.billsDueSoon, unpaidSoon - 1);
    // The other rows are still there.
    assert.equal(snap.everyday.length, before.everyday.length);

    const again = await action({ kind: "everyday", id: "ev-phone", action: "mark-paid" });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { changed: boolean }).changed, false);
  });

  test("undo puts a bill back the way it was", async () => {
    await setup();
    await action({ kind: "everyday", id: "ev-phone", action: "mark-paid" });
    const res = await action({ kind: "everyday", id: "ev-phone", action: "undo" });
    assert.equal(res.status, 200);
    const phone = (await getMoneySnapshot()).everyday.find((r) => r.id === "ev-phone");
    assert.equal(phone?.paid, false);
    assert.equal(phone?.dashboardChange, undefined);
    assert.equal((await action({ kind: "everyday", id: "ev-phone", action: "undo" })).status, 400);
  });

  test("cancel and sold change status and stage", async () => {
    await setup();
    assert.equal((await action({ kind: "subscription", id: "sub-video", action: "cancel" })).status, 200);
    assert.equal((await action({ kind: "sell", id: "sell-shelf", action: "sold" })).status, 200);
    const snap = await getMoneySnapshot();
    assert.equal(snap.subscriptions.find((s) => s.id === "sub-video")?.status, "cancelled");
    assert.equal(snap.sell.find((s) => s.id === "sell-shelf")?.stage, "sold");
    assert.ok(!snap.alerts.some((a) => a.id === "money-cancel"));
  });

  test("a stale agent ingest does not undo the change", async () => {
    await setup();
    await action({ kind: "everyday", id: "ev-phone", action: "mark-paid" });
    const before = (await getMoneySnapshot()).everyday.find((r) => r.id === "ev-phone");
    assert.ok(before);

    const ingest = await ingestPost(
      new Request(`${ORIGIN}/api/money/ingest`, {
        method: "POST",
        headers: { authorization: `Bearer ${INGEST}`, "content-type": "application/json" },
        body: JSON.stringify({
          reportedBy: "muddy",
          everyday: [{ ...before, paid: false, paidAt: undefined, dashboardChange: undefined, amount: 350 }],
        }),
      }),
    );
    assert.equal(ingest.status, 200);
    const after = (await getMoneySnapshot()).everyday.find((r) => r.id === "ev-phone");
    assert.equal(after?.paid, true);
    assert.equal(after?.amount, 350);
  });

  test("GET /api/money says whether actions are on", async () => {
    await setup();
    const res = await moneyGet(new Request(`${ORIGIN}/api/money`, { headers: { authorization: BASIC } }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { actions: { path: string; enabled: boolean } };
    assert.deepEqual(body.actions, { path: "/api/money/action", enabled: true });
  });
});
