import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { POST as v1Ingest } from "@/app/api/v1/ingest/route";
import {
  DurableWriteError,
  durableGetJson,
  durableSetJson,
  durableUpdateJson,
} from "@/lib/durable/store";

const AGENT = "a".repeat(32);
const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_DEMO_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VANOS_STORE_PREFIX",
  "AGENT_API_TOKEN",
  "AGENT_API_TOKEN_PREVIOUS",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];
const realFetch = globalThis.fetch;

let dataDir = "";
let blocker = "";
let n = 0;
const uniqueKey = (name: string) => `test-${name}-${Date.now()}-${n++}`;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-durable-"));
  blocker = path.join(dataDir, "not-a-dir");
  await writeFile(blocker, "x");
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

function local(dir = dataDir) {
  delete env.VANOS_DEMO_MODE;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  env.VANOS_DATA_DIR = dir;
  env.BOTS_DATA_DIR = dir;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

/**
 * A tiny Upstash stand-in that understands the commands the store sends.
 * `beforeEval` lets a test slip in a competing write.
 */
function fakeUpstash(opts: { beforeEval?: (db: Map<string, string>) => void; failEval?: boolean } = {}) {
  const db = new Map<string, string>();
  let evals = 0;
  env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.test";
  env.UPSTASH_REDIS_REST_TOKEN = "t".repeat(32);
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const cmd = JSON.parse(String(init?.body)) as (string | number)[];
    const op = String(cmd[0]).toUpperCase();
    let result: unknown = null;
    if (op === "GET") result = db.get(String(cmd[1])) ?? null;
    else if (op === "SET") {
      db.set(String(cmd[1]), String(cmd[2]));
      result = "OK";
    } else if (op === "MGET") result = cmd.slice(1).map((k) => db.get(String(k)) ?? null);
    else if (op === "EVAL") {
      evals += 1;
      if (opts.failEval) return new Response("boom", { status: 500 });
      opts.beforeEval?.(db);
      const [, , , docKey, verKey, expected, value] = cmd.map(String);
      const ver = db.get(verKey) ?? "0";
      if (ver !== expected) result = 0;
      else {
        db.set(docKey, value);
        db.set(verKey, String(Number(ver) + 1));
        result = 1;
      }
    } else if (op === "PING") result = "PONG";
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return { db, evals: () => evals };
}

describe("durable store, local backend", () => {
  test("parallel updates to one key all land", async () => {
    local();
    const key = uniqueKey("counter");
    await Promise.all(
      Array.from({ length: 25 }, () =>
        durableUpdateJson<{ count: number }>(key, (cur) => ({ count: (cur?.count ?? 0) + 1 })),
      ),
    );
    assert.deepEqual(await durableGetJson(key), { count: 25 });
  });

  test("returning null leaves the document alone", async () => {
    local();
    const key = uniqueKey("noop");
    await durableSetJson(key, { v: 1 });
    await durableUpdateJson(key, () => null);
    assert.deepEqual(await durableGetJson(key), { v: 1 });
  });

  test("a write that cannot persist throws instead of pretending", async () => {
    local(path.join(blocker, "sub"));
    await assert.rejects(durableSetJson(uniqueKey("ro"), { v: 1 }), DurableWriteError);
  });

  test("an ingest whose write fails answers 503, not ok", async () => {
    local(path.join(blocker, "sub"));
    env.NODE_ENV = "production";
    env.AGENT_API_TOKEN = AGENT;
    const res = await v1Ingest(
      new Request("http://127.0.0.1:3000/api/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${AGENT}`, "content-type": "application/json" },
        body: JSON.stringify({
          domain: "costs",
          lines: [{ name: "Test", provider: "x", category: "llm", amountUsd: 1 }],
        }),
      }),
    );
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "5");
  });
});

describe("durable store, Upstash backend", () => {
  test("a competing write makes the update retry on fresh data", async () => {
    local();
    const key = uniqueKey("cas");
    let raced = false;
    const fake = fakeUpstash({
      beforeEval: (db) => {
        if (raced) return;
        raced = true;
        // Someone else appends "other" between our read and our write.
        db.set(`vanos:${key}`, JSON.stringify({ items: ["other"] }));
        db.set(`vanos:${key}:ver`, "1");
      },
    });
    let runs = 0;
    await durableUpdateJson<{ items: string[] }>(key, (cur) => {
      runs += 1;
      return { items: [...(cur?.items ?? []), "mine"] };
    });
    assert.equal(runs, 2);
    assert.equal(fake.evals(), 2);
    assert.deepEqual(JSON.parse(fake.db.get(`vanos:${key}`)!), { items: ["other", "mine"] });
    assert.equal(fake.db.get(`vanos:${key}:ver`), "2");
  });

  test("an Upstash failure throws DurableWriteError", async () => {
    local();
    fakeUpstash({ failEval: true });
    await assert.rejects(
      durableUpdateJson(uniqueKey("fail"), () => ({ v: 1 })),
      DurableWriteError,
    );
  });
});
