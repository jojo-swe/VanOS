import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as dfPost } from "@/app/api/displayfusion/route";
import { POST as haPost } from "@/app/api/homeassistant/route";
import { POST as haV1Post } from "@/app/api/v1/homeassistant/route";
import { parseDfArgs } from "@/lib/displayfusion/config";
import { isHaServiceAllowed } from "@/lib/homeassistant/config";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { proxy } from "@/proxy";

const USER = "jojo";
const PASS = "p".repeat(32);
const BASIC = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const AGENT = "a".repeat(32);
const EDGE = "e".repeat(32);
const DF_SECRET = "f".repeat(32);

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_ACCESS_MODE",
  "VANOS_PUBLIC_INGEST",
  "VANOS_EDGE_SECRET",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "AGENT_API_TOKEN",
  "HA_ALLOWED_SERVICES",
  "HOME_ASSISTANT_ALLOWED_SERVICES",
  "HOME_ASSISTANT_URL",
  "HOME_ASSISTANT_TOKEN",
  "HA_URL",
  "HA_TOKEN",
  "DISPLAYFUSION_BRIDGE_URL",
  "DISPLAYFUSION_BRIDGE_SECRET",
  "DF_BRIDGE_URL",
  "DF_BRIDGE_SECRET",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

let dataDir = "";

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-hardening-"));
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key === "VANOS_DATA_DIR" || key === "BOTS_DATA_DIR") continue;
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearRateLimits();
});

/** Production, basic auth and agent token set; HA and DF bridge unset. */
function production() {
  env.NODE_ENV = "production";
  env.DASHBOARD_BASIC_USER = USER;
  env.DASHBOARD_BASIC_PASSWORD = PASS;
  env.AGENT_API_TOKEN = AGENT;
  for (const key of [
    "HA_ALLOWED_SERVICES",
    "HOME_ASSISTANT_ALLOWED_SERVICES",
    "HOME_ASSISTANT_URL",
    "HOME_ASSISTANT_TOKEN",
    "HA_URL",
    "HA_TOKEN",
    "DISPLAYFUSION_BRIDGE_URL",
    "DF_BRIDGE_URL",
    "DF_BRIDGE_SECRET",
    "VANOS_TOTP_SECRET",
    "VANOS_SESSION_SECRET",
  ]) {
    delete env[key];
  }
}

function request(pathname: string, init: RequestInit = {}): Request {
  return new Request(new URL(pathname, "http://127.0.0.1:3000"), init);
}

function gate(pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return proxy(new NextRequest(new URL(pathname, "http://127.0.0.1:3000"), init));
}

const SAME_ORIGIN = {
  authorization: BASIC,
  "content-type": "application/json",
  origin: "http://127.0.0.1:3000",
  "sec-fetch-site": "same-origin",
};

describe("Home Assistant service allowlist", () => {
  test("the default allows lights and switches, not locks, alarms or HA itself", async () => {
    delete env.HA_ALLOWED_SERVICES;
    delete env.HOME_ASSISTANT_ALLOWED_SERVICES;
    assert.equal(isHaServiceAllowed("light", "turn_on"), true);
    assert.equal(isHaServiceAllowed("switch", "toggle"), true);
    assert.equal(isHaServiceAllowed("scene", "turn_on"), true);
    assert.equal(isHaServiceAllowed("lock", "unlock"), false);
    assert.equal(isHaServiceAllowed("alarm_control_panel", "alarm_disarm"), false);
    assert.equal(isHaServiceAllowed("homeassistant", "stop"), false);
    assert.equal(isHaServiceAllowed("cover", "open_cover"), false);
    assert.equal(isHaServiceAllowed("light/../lock", "unlock"), false);
  });

  test("HA_ALLOWED_SERVICES replaces the default and ignores a bare wildcard", async () => {
    env.HA_ALLOWED_SERVICES = "lock.unlock, *, climate.*";
    assert.equal(isHaServiceAllowed("lock", "unlock"), true);
    assert.equal(isHaServiceAllowed("lock", "lock"), false);
    assert.equal(isHaServiceAllowed("climate", "set_temperature"), true);
    assert.equal(isHaServiceAllowed("light", "turn_on"), false);
    assert.equal(isHaServiceAllowed("homeassistant", "stop"), false);
  });

  test("the agent route refuses a service outside the allowlist", async () => {
    production();
    const res = await haV1Post(
      request("/api/v1/homeassistant", {
        method: "POST",
        headers: { authorization: `Bearer ${AGENT}`, "content-type": "application/json" },
        body: JSON.stringify({ domain: "lock", service: "unlock", entityId: "lock.front_door" }),
      }),
    );
    assert.equal(res.status, 403);
  });

  test("the dashboard route refuses a service outside the allowlist", async () => {
    production();
    const res = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: SAME_ORIGIN,
        body: JSON.stringify({ domain: "homeassistant", service: "stop" }),
      }),
    );
    assert.equal(res.status, 403);
  });
});

describe("CSRF with the edge header", () => {
  test("X-VanOS-Edge does not skip the CSRF check", async () => {
    production();
    env.VANOS_EDGE_SECRET = EDGE;

    const plain = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: { authorization: BASIC, "x-vanos-edge": EDGE, "content-type": "text/plain" },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(plain.status, 403);

    const crossSite = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: {
          authorization: BASIC,
          "x-vanos-edge": EDGE,
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(crossSite.status, 403);

    const edgeOnly = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: { "x-vanos-edge": EDGE, "content-type": "application/json" },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(edgeOnly.status, 401);
  });
});

describe("DisplayFusion gate", () => {
  test("without the bridge secret the path gets the full dashboard gate", async () => {
    production();
    env.VANOS_ACCESS_MODE = "hybrid";
    env.VANOS_PUBLIC_INGEST = "true";
    env.DISPLAYFUSION_BRIDGE_SECRET = DF_SECRET;

    assert.equal((await gate("/api/displayfusion", { method: "POST" })).status, 401);
    assert.equal((await gate("/api/displayfusion/", { method: "POST" })).status, 401);
    assert.equal(
      (await gate("/api/displayfusion", { method: "POST", headers: { authorization: "Bearer wrong" } })).status,
      401,
    );

    const bridge = (await gate("/api/displayfusion", {
      method: "POST",
      headers: { "x-vanos-df-secret": DF_SECRET },
    }));
    assert.equal(bridge.status, 200);
  });

  test("the bridge secret may post results but not run commands", async () => {
    production();
    env.DISPLAYFUSION_BRIDGE_SECRET = DF_SECRET;

    const run = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: { authorization: `Bearer ${DF_SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ scriptId: "next-monitor" }),
      }),
    );
    assert.equal(run.status, 401);

    const runWithBasic = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: { ...SAME_ORIGIN, "x-vanos-df-secret": DF_SECRET },
        body: JSON.stringify({ scriptId: "next-monitor" }),
      }),
    );
    assert.equal(runWithBasic.status, 401);

    const forgedCallback = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: SAME_ORIGIN,
        body: JSON.stringify({ type: "result", ok: true, summary: "forged" }),
      }),
    );
    assert.equal(forgedCallback.status, 401);

    const callback = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: { "x-vanos-df-secret": DF_SECRET, "content-type": "application/json" },
        body: JSON.stringify({ type: "result", ok: true, summary: "done" }),
      }),
    );
    assert.equal(callback.status, 200);
  });

  test("args that look like flags or carry quotes are rejected", async () => {
    production();

    const flag = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: SAME_ORIGIN,
        body: JSON.stringify({ scriptId: "next-monitor", args: ["-functionrun", "Other"] }),
      }),
    );
    assert.equal(flag.status, 400);

    assert.equal(parseDfArgs(['Monitor "2"']).ok, false);
    assert.equal(parseDfArgs(["$env:SECRET"]).ok, false);
    assert.equal(parseDfArgs("not-an-array").ok, false);
    assert.equal(parseDfArgs(Array.from({ length: 9 }, () => "x")).ok, false);
    assert.deepEqual(parseDfArgs(["Monitor 2", "left"]), { ok: true, args: ["Monitor 2", "left"] });
    assert.deepEqual(parseDfArgs(undefined), { ok: true });

    const ok = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: SAME_ORIGIN,
        body: JSON.stringify({ scriptId: "next-monitor", args: ["Monitor 2"] }),
      }),
    );
    assert.equal(ok.status, 200);
  });
});
