import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as dispatchPost } from "@/app/api/bots/dispatch/route";
import { GET as statusGet } from "@/app/api/bots/status/route";
import { POST as dfPost, GET as dfGet } from "@/app/api/displayfusion/route";
import { POST as haPost } from "@/app/api/homeassistant/route";
import { GET as moneyGet } from "@/app/api/money/route";
import { POST as dfV1Post } from "@/app/api/v1/displayfusion/route";
import { publicTargetView, getGrokBotTargets } from "@/lib/bots/config";
import { accessClientIp, logAuthFail } from "@/lib/security/access-log";
import { tailscaleSourceIp } from "@/lib/security/cgnat";
import { resolveNetworkIdentity } from "@/lib/security/identity";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { reportStartup } from "@/lib/security/startup-log";
import { proxy } from "@/proxy";

const USER = "jojo";
const PASS = "p".repeat(32);
const BASIC = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const AGENT = "a".repeat(32);
const EDGE = "e".repeat(32);
const WEBHOOK = "http://203.0.113.10/hook/demo";
const WEBHOOK_KEY = "k".repeat(32);

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DEMO_MODE",
  "VANOS_TRUST_PROXY",
  "VANOS_TRUST_TAILSCALE_CGNAT",
  "VANOS_REQUIRE_NETWORK_GATE",
  "VANOS_ALLOWED_TAILSCALE_USERS",
  "VANOS_EDGE_SECRET",
  "VANOS_RATE_LIMIT_PER_MIN",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "AGENT_API_TOKEN",
  "AGENT_API_TOKEN_PREVIOUS",
  "BOTS_INGEST_SECRET",
  "BOTS_INGEST_SECRET_PREVIOUS",
  "VANOS_ALLOW_INGEST_AS_AGENT",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "VANOS_SESSION_TTL_DAYS",
  "VANOS_SESSION_TTL_SECONDS",
  "VANOS_TOTP_RECOVERY_CODES",
  "VANOS_TOTP_RECOVERY_FILE",
  "VANOS_TOTP_RECOVERY_USED_FILE",
  "GROK_BOT_MUDDY_WEBHOOK_URL",
  "GROK_BOT_MUDDY_WEBHOOK_KEY",
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
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-remediation-"));
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

function gate(pathname: string, headers?: Record<string, string>, ip?: string) {
  const req = new NextRequest(new URL(pathname, "http://127.0.0.1:3000"), { headers });
  if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
  return proxy(req);
}

function request(
  pathname: string,
  init: RequestInit & { ip?: string } = {},
): Request {
  const { ip, ...rest } = init;
  const req = new Request(new URL(pathname, "http://127.0.0.1:3000"), rest);
  if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
  return req;
}

async function capture(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return lines.flatMap((chunk) => chunk.split("\n")).filter((line) => line.length > 0);
}

describe("edge dashboard basic auth and webhook URL", () => {
  test("configured basic auth is required for the dashboard and read APIs", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    env.VANOS_EDGE_DASHBOARD = "true";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    delete env.VANOS_TRUST_PROXY;

    for (const pathname of ["/dashboard", "/api/money", "/api/bots/status", "/api/setup"]) {
      assert.equal((await gate(pathname)).status, 401, pathname);
      assert.equal((await gate(pathname, { authorization: BASIC })).status, 200, pathname);
    }
    assert.equal((await gate("/api/bots/ingest")).status, 200);

    const closed = await moneyGet(request("/api/money"));
    assert.equal(closed.status, 401);
    const open = await moneyGet(request("/api/money", { headers: { authorization: BASIC } }));
    assert.equal(open.status, 200);

    // Without credentials the edge dashboard fails closed instead of opening.
    delete env.DASHBOARD_BASIC_USER;
    delete env.DASHBOARD_BASIC_PASSWORD;
    assert.equal((await gate("/dashboard")).status, 503);
    assert.equal((await gate("/api/money")).status, 503);
    assert.equal((await moneyGet(request("/api/money"))).status, 401);
  });

  test("status omits webhook URL and key", async () => {
    env.NODE_ENV = "production";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    env.GROK_BOT_MUDDY_WEBHOOK_URL = WEBHOOK;
    env.GROK_BOT_MUDDY_WEBHOOK_KEY = WEBHOOK_KEY;

    const view = publicTargetView(getGrokBotTargets());
    const muddy = view.find((bot) => bot.id === "muddy");
    assert.ok(muddy);
    assert.equal(muddy.hasKey, true);
    assert.equal(muddy.configured, true);
    assert.equal("webhookUrl" in muddy, false);
    assert.equal("webhookKey" in muddy, false);

    const res = await statusGet(
      request("/api/bots/status", { headers: { authorization: BASIC } }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { targets: Array<Record<string, unknown>> };
    const row = body.targets.find((bot) => bot.id === "muddy");
    assert.equal(row?.hasKey, true);
    assert.equal(JSON.stringify(body).includes(WEBHOOK), false);
    assert.equal(JSON.stringify(body).includes(WEBHOOK_KEY), false);
  });
});

describe("basic-auth mutation CSRF", () => {
  test("home assistant, displayfusion, and dispatch reject cross-site basic auth", async () => {
    env.NODE_ENV = "production";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    delete env.HOME_ASSISTANT_URL;
    delete env.HA_URL;
    delete env.DISPLAYFUSION_BRIDGE_URL;
    delete env.DF_BRIDGE_URL;

    const same = {
      authorization: BASIC,
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    };

    const haCross = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: {
          authorization: BASIC,
          "content-type": "text/plain",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(haCross.status, 403);

    const haOrigin = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: { ...same, origin: "https://evil.example" },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(haOrigin.status, 403);

    const haSite = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: { ...same, "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(haSite.status, 403);

    const haOk = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: { ...same, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ domain: "light", service: "turn_on", entityId: "light.demo" }),
      }),
    );
    assert.equal(haOk.status, 200);
    const haBody = (await haOk.json()) as { call: { domain: string; ok: boolean } };
    assert.equal(haBody.call.domain, "light");
    assert.equal(haBody.call.ok, false);

    const dfPlain = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: { authorization: BASIC, "content-type": "text/plain" },
        body: JSON.stringify({ scriptId: "next-monitor" }),
      }),
    );
    assert.equal(dfPlain.status, 403);

    const dispatchCross = await dispatchPost(
      request("/api/bots/dispatch", {
        method: "POST",
        headers: {
          authorization: BASIC,
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ botId: "muddy", task: "ping" }),
      }),
    );
    assert.equal(dispatchCross.status, 403);

    const dispatchCurl = await dispatchPost(
      request("/api/bots/dispatch", {
        method: "POST",
        headers: { authorization: BASIC, "content-type": "application/json" },
        body: JSON.stringify({ botId: "muddy", task: "ping" }),
      }),
    );
    assert.notEqual(dispatchCurl.status, 403);
    assert.notEqual(dispatchCurl.status, 401);
  });

  test("agent bearer is not subject to the browser origin check", async () => {
    env.NODE_ENV = "production";
    env.AGENT_API_TOKEN = AGENT;
    delete env.DASHBOARD_BASIC_USER;
    delete env.DASHBOARD_BASIC_PASSWORD;
    const res = await haPost(
      request("/api/homeassistant", {
        method: "POST",
        headers: {
          authorization: `Bearer ${AGENT}`,
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ domain: "light", service: "turn_on" }),
      }),
    );
    assert.equal(res.status, 200);
  });
});

describe("forwarded client address", () => {
  test("rate limits and auth audit share the socket unless the proxy is trusted", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    env.VANOS_RATE_LIMIT_PER_MIN = "1";
    delete env.VANOS_TRUST_PROXY;

    const first = (await gate("/api/bots/ingest", { "x-forwarded-for": "203.0.113.21" }, "198.51.100.8"));
    const rotated = (await gate("/api/bots/ingest", { "x-forwarded-for": "203.0.113.22" }, "198.51.100.8"));
    assert.equal(first.status, 200);
    assert.equal(rotated.status, 429);

    const otherSocket = (await gate(
      "/api/bots/ingest",
      { "x-forwarded-for": "203.0.113.21", "x-real-ip": "203.0.113.99" },
      "198.51.100.9",
    ));
    assert.equal(otherSocket.status, 200);

    env.VANOS_TRUST_PROXY = "true";
    clearRateLimits();
    const trusted = (await gate(
      "/api/bots/ingest",
      { "x-forwarded-for": "203.0.113.9, 198.51.100.50" },
      "127.0.0.1",
    ));
    const forgedLeft = (await gate(
      "/api/bots/ingest",
      { "x-forwarded-for": "198.51.100.77, 198.51.100.50" },
      "127.0.0.1",
    ));
    assert.equal(trusted.status, 200);
    assert.equal(forgedLeft.status, 429);
    const newClient = (await gate(
      "/api/bots/ingest",
      { "x-forwarded-for": "203.0.113.9, 198.51.100.51" },
      "127.0.0.1",
    ));
    assert.equal(newClient.status, 200);

    const logged = (await capture(async () => {
      logAuthFail(
        request("/dashboard", {
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.8" },
          ip: "127.0.0.1",
        }),
        "basic_auth_fail",
      );
    }));
    const row = JSON.parse(logged[0] ?? "{}") as { ip?: string };
    assert.equal(row.ip, "10.0.0.8");
    assert.equal(
      accessClientIp({
        ip: "127.0.0.1",
        headers: { get: () => "203.0.113.9, 10.0.0.8" },
      }),
      row.ip,
    );

    delete env.VANOS_TRUST_PROXY;
    const untrusted = (await capture(async () => {
      logAuthFail(
        request("/dashboard", {
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.8" },
          ip: "127.0.0.1",
        }),
        "basic_auth_fail",
      );
    }));
    assert.equal(JSON.parse(untrusted[0] ?? "{}").ip, "127.0.0.1");
  });

  test("CGNAT headers and Tailscale-User-Login require a trusted proxy", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "private";
    env.VANOS_REQUIRE_NETWORK_GATE = "true";
    env.VANOS_TRUST_TAILSCALE_CGNAT = "true";
    env.VANOS_ALLOWED_TAILSCALE_USERS = "jojo@github";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    delete env.VANOS_EDGE_SECRET;
    delete env.VANOS_TRUST_PROXY;

    assert.equal(
      (await gate("/dashboard", {
        authorization: BASIC,
        "x-real-ip": "100.80.1.5",
        "tailscale-user-login": "jojo@github",
      })).status,
      403,
    );
    assert.equal(
      resolveNetworkIdentity(
        request("/dashboard", { headers: { "tailscale-user-login": "jojo@github" } }),
      ).ok,
      false,
    );
    assert.equal(
      tailscaleSourceIp(
        request("/dashboard", { headers: { "x-real-ip": "100.80.1.5" } }),
      ),
      undefined,
    );

    const socket = request("/dashboard", { ip: "100.80.1.5" });
    assert.equal(tailscaleSourceIp(socket), "100.80.1.5");
    assert.equal((await gate("/dashboard", { authorization: BASIC }, "100.80.1.5")).status, 200);

    env.VANOS_TRUST_PROXY = "true";
    const viaHeader = resolveNetworkIdentity(
      request("/dashboard", { headers: { "tailscale-user-login": "jojo@github" } }),
    );
    assert.equal(viaHeader.ok, true);
    assert.equal(viaHeader.via, "tailscale");
    assert.equal(
      (await gate("/dashboard", {
        authorization: BASIC,
        "x-real-ip": "100.90.0.8",
      })).status,
      200,
    );
  });
});

describe("dashboard basic auth limits", () => {
  test("failed basic auth is rate limited", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "hybrid";
    env.VANOS_RATE_LIMIT_PER_MIN = "1";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    const wrong = "Basic " + Buffer.from(`${USER}:nope`).toString("base64");
    const headers = { authorization: wrong, "x-forwarded-for": "203.0.113.70" };
    assert.equal((await gate("/dashboard", headers, "192.0.2.10")).status, 401);
    assert.equal(
      (await gate("/dashboard", { ...headers, "x-forwarded-for": "203.0.113.71" }, "192.0.2.10")).status,
      429,
    );
    assert.equal(
      (await gate("/dashboard", { authorization: BASIC }, "192.0.2.10")).status,
      200,
    );
  });

  test("a short dashboard password warns and sets config_ok false without exiting", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "private";
    delete env.AGENT_API_TOKEN;
    delete env.AGENT_API_TOKEN_PREVIOUS;
    delete env.BOTS_INGEST_SECRET;
    delete env.BOTS_INGEST_SECRET_PREVIOUS;
    delete env.VANOS_TOTP_SECRET;
    delete env.VANOS_SESSION_SECRET;
    env.DASHBOARD_BASIC_PASSWORD = "short-pass";

    let warned = "";
    const warn = console.warn;
    console.warn = (message?: unknown) => {
      warned += String(message);
    };
    let logged: Array<Record<string, unknown>> = [];
    try {
      logged = (await capture(async () => {
        reportStartup(() => {
          throw new Error("should not exit");
        });
      })).map((line) => JSON.parse(line) as Record<string, unknown>);
    } finally {
      console.warn = warn;
    }
    assert.equal(logged[0]?.config_ok, false);
    assert.equal(logged[0]?.reason, "short_password");
    assert.equal(logged[0]?.level, "warn");
    assert.equal(JSON.stringify(logged).includes("short-pass"), false);
    assert.match(warned, /DASHBOARD_BASIC_PASSWORD/);
    assert.equal(warned.includes("short-pass"), false);

    env.DASHBOARD_BASIC_PASSWORD = PASS;
    const ok = (await capture(async () => {
      reportStartup(() => {
        throw new Error("should not exit");
      });
    })).map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(ok[0]?.config_ok, true);
    assert.equal("reason" in (ok[0] ?? {}), false);
  });
});

describe("DisplayFusion allowlist", () => {
  test("unknown commands are rejected and the edge secret cannot run them", async () => {
    env.NODE_ENV = "production";
    env.DASHBOARD_BASIC_USER = USER;
    env.DASHBOARD_BASIC_PASSWORD = PASS;
    env.VANOS_EDGE_SECRET = EDGE;
    env.AGENT_API_TOKEN = AGENT;
    delete env.DISPLAYFUSION_BRIDGE_URL;
    delete env.DF_BRIDGE_URL;
    delete env.DISPLAYFUSION_BRIDGE_SECRET;
    delete env.DF_BRIDGE_SECRET;

    const headers = {
      authorization: BASIC,
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    };

    const edgeOnly = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vanos-edge": EDGE,
        },
        body: JSON.stringify({ command: "MoveWindowToNextMonitor" }),
      }),
    );
    assert.equal(edgeOnly.status, 401);
    assert.equal(
      (await dfGet(request("/api/displayfusion", { headers: { "x-vanos-edge": EDGE } }))).status,
      401,
    );

    const unknown = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers,
        body: JSON.stringify({ command: "NotACatalogCommand", args: ["x"] }),
      }),
    );
    assert.equal(unknown.status, 400);
    const unknownBody = (await unknown.json()) as { error: string };
    assert.match(unknownBody.error, /allowlist/);
    assert.equal(unknownBody.error.includes("NotACatalogCommand"), false);

    const allowed = await dfPost(
      request("/api/displayfusion", {
        method: "POST",
        headers,
        body: JSON.stringify({
          scriptId: "next-monitor",
          command: "NotACatalogCommand",
        }),
      }),
    );
    assert.equal(allowed.status, 200);
    const allowedBody = (await allowed.json()) as { run: { command: string; accepted: boolean } };
    assert.equal(allowedBody.run.command, "MoveWindowToNextMonitor");
    assert.equal(allowedBody.run.accepted, false);

    const v1 = await dfV1Post(
      request("/api/v1/displayfusion", {
        method: "POST",
        headers: {
          authorization: `Bearer ${AGENT}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "NotACatalogCommand" }),
      }),
    );
    assert.equal(v1.status, 400);
  });
});
