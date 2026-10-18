import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { accessClientIp } from "@/lib/security/access-log";
import { clearRateLimits, rateLimitConsume } from "@/lib/security/rate-limit";
import { proxy } from "@/proxy";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL",
  "VANOS_TRUST_PROXY",
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DEMO_MODE",
  "VANOS_RATE_LIMIT_PER_MIN",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearRateLimits();
});

function headers(values: Record<string, string>) {
  return { headers: new Headers(values) };
}

/** Upstash stand-in that only knows the rate-limit script. */
function fakeUpstash(opts: { fail?: boolean } = {}) {
  const counters = new Map<string, number>();
  env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.test";
  env.UPSTASH_REDIS_REST_TOKEN = "t".repeat(32);
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (opts.fail) return new Response("down", { status: 503 });
    const cmd = JSON.parse(String(init?.body)) as (string | number)[];
    const key = String(cmd[3]);
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return new Response(JSON.stringify({ result: n }), { status: 200 });
  }) as typeof fetch;
  return counters;
}

describe("client IP on Vercel", () => {
  test("Vercel's X-Real-IP is used when VERCEL=1", () => {
    env.VERCEL = "1";
    delete env.VANOS_TRUST_PROXY;
    assert.equal(accessClientIp(headers({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
    assert.equal(
      accessClientIp(headers({ "x-vercel-forwarded-for": "198.51.100.4, 10.0.0.1" })),
      "198.51.100.4",
    );
    assert.equal(accessClientIp(headers({ "x-real-ip": "not an ip" })), "unknown");
  });

  test("off Vercel the headers are still ignored without VANOS_TRUST_PROXY", () => {
    delete env.VERCEL;
    delete env.VANOS_TRUST_PROXY;
    assert.equal(accessClientIp(headers({ "x-real-ip": "203.0.113.7" })), "unknown");
  });

  test("one caller hitting the limit does not block another", async () => {
    env.NODE_ENV = "production";
    env.VERCEL = "1";
    env.VANOS_ACCESS_MODE = "edge";
    env.VANOS_RATE_LIMIT_PER_MIN = "2";
    delete env.VANOS_EDGE_DASHBOARD;
    delete env.VANOS_DEMO_MODE;
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    const hit = (ip: string) =>
      proxy(
        new NextRequest(new URL("/api/bots/ingest", "http://127.0.0.1:3000"), {
          method: "POST",
          headers: { "x-real-ip": ip },
        }),
      );
    assert.equal((await hit("203.0.113.1")).status, 200);
    assert.equal((await hit("203.0.113.1")).status, 200);
    assert.equal((await hit("203.0.113.1")).status, 429);
    assert.equal((await hit("203.0.113.2")).status, 200);
  });
});

describe("shared rate limit", () => {
  test("counts in Upstash survive a fresh instance", async () => {
    env.VANOS_STORE_PREFIX = `rl-${Date.now()}`;
    fakeUpstash();
    assert.equal((await rateLimitConsume("k", 2)).ok, true);
    clearRateLimits(); // a new instance has no local counters
    assert.equal((await rateLimitConsume("k", 2)).ok, true);
    clearRateLimits();
    const third = await rateLimitConsume("k", 2);
    assert.equal(third.ok, false);
    assert.equal(third.remaining, 0);
  });

  test("an Upstash outage falls back to the local counter", async () => {
    fakeUpstash({ fail: true });
    assert.equal((await rateLimitConsume("down", 1)).ok, true);
    assert.equal((await rateLimitConsume("down", 1)).ok, false);
  });
});
