import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { authorizeAgent } from "@/lib/agent-api/auth";
import { authorizeIngest } from "@/lib/bots/auth";
import { isTailscaleCgnat } from "@/lib/security/cgnat";
import { resolveNetworkIdentity } from "@/lib/security/identity";
import { edgeSurface } from "@/lib/security/paths";
import { assertTokenSeparation, tokenProblems } from "@/lib/security/tokens";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { refuseEdgePage } from "@/lib/security/edge-page";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { proxy } from "@/proxy";

const AGENT = "a".repeat(32);
const AGENT_NEXT = "b".repeat(32);
const INGEST = "c".repeat(32);
const INGEST_NEXT = "d".repeat(32);

const ENV_KEYS = [
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DEMO_MODE",
  "ACCESS_MODE",
  "VANOS_EDGE_SECRET",
  "VANOS_ALLOWED_TAILSCALE_USERS",
  "VANOS_TRUST_TAILSCALE_CGNAT",
  "VANOS_TRUST_PROXY",
  "VANOS_REQUIRE_NETWORK_GATE",
  "VANOS_PUBLIC_INGEST",
  "VANOS_ALLOWED_HOSTS",
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
  "VANOS_SESSION_TTL_SECONDS",
  "VANOS_SESSION_TTL_DAYS",
  "VANOS_TOTP_MAX_ATTEMPTS",
  "VANOS_TOTP_ATTEMPT_WINDOW_SEC",
  "VANOS_TOTP_RECOVERY_CODES",
  "VANOS_TOTP_RECOVERY_FILE",
  "VANOS_TOTP_RECOVERY_USED_FILE",
  "NODE_ENV",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearRateLimits();
});

function setEnv(name: string, value: string) {
  env[name] = value;
}

function gate(path: string, headers?: Record<string, string>, ip?: string) {
  const req = new NextRequest(new URL(path, "http://127.0.0.1:3000"), {
    headers,
  });
  if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
  return proxy(req);
}

const basic =
  "Basic " + Buffer.from("jojo:dashboard-password-value").toString("base64");

describe("edge surface", () => {
  test("classifies only ingest, mcp, and health", async () => {
    assert.equal(edgeSurface("/api/bots/ingest"), "bearer");
    assert.equal(edgeSurface("/api/mcp"), "bearer");
    assert.equal(edgeSurface("/api/v1/health"), "health");
    assert.equal(edgeSurface("/api/v1"), "closed");
    assert.equal(edgeSurface("/dashboard"), "closed");
    assert.equal(edgeSurface("/api/bots/dispatch"), "closed");
    assert.equal(edgeSurface("/api/v1/ingest"), "closed");
  });

  test("edge mode returns 404 for /dashboard and /api/v1 except health", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "edge";
    delete process.env.DASHBOARD_BASIC_USER;
    delete process.env.DASHBOARD_BASIC_PASSWORD;

    assert.equal((await gate("/api/v1/health")).status, 200);
    const closed = [
      "/dashboard",
      "/api/v1",
      "/api/v1/snapshot",
      "/api/v1/ingest",
      "/api/v1/dispatch",
      "/api/v1/sync",
      "/api/v1/homeassistant",
      "/api/v1/displayfusion",
      "/api/v1/github",
      "/api/v1/notion",
      "/api/v1/obsidian",
    ];
    for (const path of closed) {
      const res = (await gate(path));
      assert.equal(res.status, 404, path);
      const body = await res.text();
      assert.equal(body, "Not found", path);
      assert.doesNotMatch(body, /Mission Control|subMonthly|generatedAt|openPrs/);
    }

    for (const path of closed) {
      const denied = denyIfEdgeClosed(path);
      assert.equal(denied?.status, 404, path);
    }
    assert.equal(denyIfEdgeClosed("/api/v1/health"), null);
    assert.equal(denyIfEdgeClosed("/api/bots/ingest"), null);
    assert.equal(denyIfEdgeClosed("/api/mcp"), null);
  });

  test("VANOS_EDGE_DASHBOARD unset keeps /dashboard 404; true serves it", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "edge";
    delete process.env.VANOS_EDGE_DASHBOARD;
    delete process.env.DASHBOARD_BASIC_USER;
    delete process.env.DASHBOARD_BASIC_PASSWORD;

    assert.equal((await gate("/dashboard")).status, 404);
    assert.equal((await gate("/api/bots/ingest")).status, 200);
    assert.equal((await gate("/api/mcp")).status, 200);
    assert.equal((await gate("/api/v1/health")).status, 200);
    assert.throws(() => refuseEdgePage());

    for (const value of ["", "false", "1", "yes", "TRUE"]) {
      process.env.VANOS_EDGE_DASHBOARD = value;
      assert.equal((await gate("/dashboard")).status, 404, value || "(empty)");
    }

    process.env.VANOS_EDGE_DASHBOARD = "true";
    // No credentials configured: fail closed, but static assets still load.
    assert.equal((await gate("/dashboard")).status, 503);
    assert.equal((await gate("/api/dashboard")).status, 503);

    setEnv("DASHBOARD_BASIC_USER", "jojo");
    setEnv("DASHBOARD_BASIC_PASSWORD", "dashboard-password-value");
    assert.equal((await gate("/dashboard", { authorization: basic })).status, 200);
    assert.equal((await gate("/", { authorization: basic })).status, 200);
    assert.equal((await gate("/support", { authorization: basic })).status, 200);
    assert.equal((await gate("/_next/static/chunks/app.js")).status, 200);
    assert.equal((await gate("/favicon.ico")).status, 200);
    assert.equal((await gate("/icon.svg")).status, 200);
    assert.equal((await gate("/apple-touch-icon.png")).status, 200);
    assert.equal((await gate("/icon-192.png")).status, 200);
    assert.equal((await gate("/icon-512.png")).status, 200);
    assert.equal((await gate("/file.svg")).status, 200);
    for (const path of [
      "/api/dashboard",
      "/api/setup",
      "/api/bots/status",
      "/api/bots/dispatch",
      "/api/connections",
      "/api/costs",
      "/api/money",
      "/api/homeassistant",
      "/api/displayfusion",
      "/api/github",
      "/api/notion",
      "/api/obsidian",
    ]) {
      assert.equal((await gate(path, { authorization: basic })).status, 200, path);
      assert.equal(denyIfEdgeClosed(path), null, path);
    }
    assert.doesNotThrow(() => refuseEdgePage());

    assert.equal((await gate("/api/bots/ingest")).status, 200);
    assert.equal((await gate("/api/mcp")).status, 200);
    assert.equal((await gate("/api/v1/health")).status, 200);
    for (const path of [
      "/api/v1",
      "/api/v1/ingest",
      "/api/v1/snapshot",
      "/api/v1/github",
      "/api/v1/notion",
      "/api/v1/obsidian",
      "/api/costs/ingest",
      "/api/connections/ingest",
    ]) {
      assert.equal((await gate(path)).status, 404, path);
    }
  });

  test("root vercel.json does not catch-all rewrite ahead of the proxy", async () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../vercel.json",
    );
    const cfg = JSON.parse(readFileSync(file, "utf8")) as {
      routes?: { src?: string; dest?: string; continue?: boolean }[];
    };
    for (const route of cfg.routes ?? []) {
      const catchAll =
        route.src === "/(.*)" || route.src === "^/(.*)" || route.src === "^(.*)";
      assert.equal(
        catchAll && route.continue !== true,
        false,
        "a terminating catch-all route is merged ahead of the Next.js proxy",
      );
    }
  });

  test("middleware exposes ingest, mcp, and health and hides the dashboard", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "edge";
    delete process.env.DASHBOARD_BASIC_USER;
    delete process.env.DASHBOARD_BASIC_PASSWORD;

    assert.equal((await gate("/api/bots/ingest")).status, 200);
    assert.equal((await gate("/api/mcp")).status, 200);
    assert.equal((await gate("/api/v1/health")).status, 200);
    for (const path of [
      "/",
      "/dashboard",
      "/support",
      "/api/v1",
      "/api/v1/snapshot",
      "/api/v1/ingest",
      "/api/v1/dispatch",
      "/api/bots/dispatch",
      "/api/costs/ingest",
      "/favicon.ico",
      "/icon.svg",
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/icon-512.png",
    ]) {
      assert.equal((await gate(path)).status, 404, path);
    }

    const health = (await gate("/api/v1/health"));
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("x-frame-options"), "DENY");
    assert.match(health.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(health.headers.get("x-vanos-access-mode"), "edge");
  });

  test("rate limits ingest on the edge", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "edge";
    process.env.VANOS_RATE_LIMIT_PER_MIN = "1";
    const headers = { "x-forwarded-for": "198.51.100.40" };
    assert.equal((await gate("/api/bots/ingest", headers)).status, 200);
    const limited = (await gate("/api/bots/ingest", headers));
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
  });
});

describe("private tailscale gate", () => {
  test("CGNAT range", async () => {
    assert.equal(isTailscaleCgnat("100.64.0.1"), true);
    assert.equal(isTailscaleCgnat("100.127.255.255"), true);
    assert.equal(isTailscaleCgnat("::ffff:100.100.1.1"), true);
    assert.equal(isTailscaleCgnat("100.63.255.255"), false);
    assert.equal(isTailscaleCgnat("100.128.0.1"), false);
    assert.equal(isTailscaleCgnat("8.8.8.8"), false);
    assert.equal(isTailscaleCgnat("not-an-ip"), false);
  });

  test("dashboard requires basic auth and accepts CGNAT only when enabled", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "private";
    process.env.DASHBOARD_BASIC_USER = "jojo";
    process.env.DASHBOARD_BASIC_PASSWORD = "dashboard-password-value";
    delete process.env.VANOS_ALLOWED_TAILSCALE_USERS;
    delete process.env.VANOS_EDGE_SECRET;
    delete process.env.VANOS_PUBLIC_INGEST;
    delete process.env.VANOS_TRUST_PROXY;

    const cgnat = { "x-real-ip": "100.80.1.5", authorization: basic };
    assert.equal((await gate("/dashboard", cgnat)).status, 403);

    process.env.VANOS_TRUST_TAILSCALE_CGNAT = "true";
    assert.equal((await gate("/dashboard", cgnat)).status, 403);
    assert.equal(
      (await gate("/dashboard", {
        "x-forwarded-for": "1.2.3.4, 100.90.0.8",
        authorization: basic,
      })).status,
      403,
    );

    const direct = (await gate("/dashboard", { authorization: basic }, "100.80.1.5"));
    assert.equal(direct.status, 200);
    assert.equal(direct.headers.get("x-vanos-network"), "tailscale-cgnat");

    process.env.VANOS_TRUST_PROXY = "true";
    const opened = (await gate("/dashboard", cgnat));
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get("x-vanos-network"), "tailscale-cgnat");

    assert.equal(
      (await gate("/dashboard", {
        "x-real-ip": "100.128.0.1",
        authorization: basic,
      })).status,
      403,
    );
    assert.equal(
      (await gate("/dashboard", {
        "x-forwarded-for": "1.2.3.4, 100.90.0.8",
        authorization: basic,
      })).status,
      200,
    );
    assert.equal((await gate("/api/v1/sync")).status, 403);
    assert.equal(
      (await gate("/dashboard", {
        "x-forwarded-for": "100.80.1.5, 203.0.113.5",
        authorization: basic,
      })).status,
      403,
    );

    const cgnatOnly = resolveNetworkIdentity(
      new Request("http://127.0.0.1:3000/dashboard", {
        headers: { "x-real-ip": "100.80.1.5" },
      }),
    );
    assert.equal(cgnatOnly.ok, true);
    assert.equal(cgnatOnly.via, "tailscale-cgnat");

    const spoofedLogin = resolveNetworkIdentity(
      new Request("http://127.0.0.1:3000/dashboard", {
        headers: {
          "tailscale-user-login": "other@github",
          "x-real-ip": "100.80.1.5",
        },
      }),
    );
    assert.equal(spoofedLogin.ok, false);

    process.env.VANOS_ALLOWED_TAILSCALE_USERS = "jojo@github";
    const rejected = resolveNetworkIdentity(
      new Request("http://127.0.0.1:3000/dashboard", {
        headers: {
          "tailscale-user-login": "other@github",
          "x-real-ip": "100.80.1.5",
        },
      }),
    );
    assert.equal(rejected.ok, false);
  });
});

describe("token separation and rotation", () => {
  test("startup fails when a token is short or the two tokens match", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.AGENT_API_TOKEN;
    delete process.env.AGENT_API_TOKEN_PREVIOUS;
    delete process.env.BOTS_INGEST_SECRET;
    delete process.env.BOTS_INGEST_SECRET_PREVIOUS;
    assert.deepEqual(tokenProblems(), []);

    process.env.AGENT_API_TOKEN = "short-token";
    process.env.BOTS_INGEST_SECRET = INGEST;
    assert.ok(tokenProblems().some((problem) => problem.includes("AGENT_API_TOKEN is shorter")));
    assert.throws(() => assertTokenSeparation(), /Refusing to start/);

    process.env.AGENT_API_TOKEN = AGENT;
    process.env.BOTS_INGEST_SECRET = AGENT;
    assert.ok(
      tokenProblems().some((problem) =>
        problem.includes("AGENT_API_TOKEN must not equal BOTS_INGEST_SECRET"),
      ),
    );

    process.env.BOTS_INGEST_SECRET = INGEST;
    process.env.AGENT_API_TOKEN_PREVIOUS = INGEST;
    assert.ok(tokenProblems().some((problem) => problem.includes("PREVIOUS")));
    assert.equal(
      tokenProblems().some((problem) => problem.includes(AGENT)),
      false,
    );

    process.env.AGENT_API_TOKEN_PREVIOUS = AGENT_NEXT;
    process.env.BOTS_INGEST_SECRET_PREVIOUS = INGEST_NEXT;
    assert.deepEqual(tokenProblems(), []);
    assert.doesNotThrow(() => assertTokenSeparation());
  });

  test("previous tokens are accepted and do not cross scopes", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.VANOS_ALLOW_INGEST_AS_AGENT;
    process.env.AGENT_API_TOKEN = AGENT;
    process.env.AGENT_API_TOKEN_PREVIOUS = AGENT_NEXT;
    process.env.BOTS_INGEST_SECRET = INGEST;
    process.env.BOTS_INGEST_SECRET_PREVIOUS = INGEST_NEXT;

    const bearer = (token: string) =>
      new Request("http://127.0.0.1:3000/api/test", {
        headers: { authorization: `Bearer ${token}` },
      });

    assert.equal(authorizeAgent(bearer(AGENT)), true);
    assert.equal(authorizeAgent(bearer(AGENT_NEXT)), true);
    assert.equal(authorizeAgent(bearer(INGEST)), false);
    assert.equal(authorizeAgent(bearer(INGEST_NEXT)), false);
    assert.equal(authorizeIngest(bearer(INGEST)), true);
    assert.equal(authorizeIngest(bearer(INGEST_NEXT)), true);
    assert.equal(authorizeIngest(bearer(AGENT)), false);
    assert.equal(authorizeIngest(bearer(AGENT_NEXT)), false);
  });

  test("brand icons load without the dashboard challenge", async () => {
    setEnv("NODE_ENV", "production");
    process.env.VANOS_ACCESS_MODE = "private";
    process.env.DASHBOARD_BASIC_USER = "jojo";
    process.env.DASHBOARD_BASIC_PASSWORD = "dashboard-password-value";

    assert.equal((await gate("/dashboard")).status, 403);
    for (const path of [
      "/favicon.ico",
      "/icon.svg",
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/icon-512.png",
    ]) {
      const res = (await gate(path));
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get("www-authenticate"), null, path);
    }
  });
});
