import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as ingestPost } from "@/app/api/bots/ingest/route";
import { GET as botsStatus } from "@/app/api/bots/status/route";
import { POST as mfaPost } from "@/app/api/auth/mfa/route";
import { demoBanner, demoEndpointDisabled } from "@/lib/demo/mode";
import { durableGetJson, durablePing, durableSetJson } from "@/lib/durable/store";
import { getGithubSnapshot } from "@/lib/github/snapshot";
import { getNotionSnapshot } from "@/lib/notion/snapshot";
import { getObsidianSnapshot } from "@/lib/obsidian/snapshot";
import { getHaSnapshot } from "@/lib/homeassistant/store";
import { getDfSnapshot } from "@/lib/displayfusion/store";
import { getConnectionsSnapshot } from "@/lib/connections/store";
import { getSetupStatus } from "@/lib/sync/setup";
import { isDemoMode } from "@/lib/security/config";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { proxy } from "@/proxy";

const ENV_KEYS = [
  "VANOS_DEMO_MODE",
  "VANOS_DEMO_REPO_URL",
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_REQUIRE_NETWORK_GATE",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "BOTS_INGEST_SECRET",
  "BOTS_DATA_DIR",
  "VANOS_DATA_DIR",
  "AGENT_API_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "NOTION_TOKEN",
  "NOTION_DATABASE_IDS",
  "OBSIDIAN_VAULT_PATH",
  "OBSIDIAN_API_URL",
  "OBSIDIAN_API_KEY",
  "HOME_ASSISTANT_URL",
  "HOME_ASSISTANT_TOKEN",
  "DISPLAYFUSION_BRIDGE_URL",
  "DISPLAYFUSION_BRIDGE_SECRET",
  "GROK_BOT_DEFAULT_WEBHOOK_URL",
  "GROK_BOT_DEFAULT_WEBHOOK_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VANOS_PRIVATE_APP_URL",
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

function gate(path: string, method = "GET", headers?: Record<string, string>) {
  return proxy(
    new NextRequest(new URL(path, "http://127.0.0.1:3000"), { method, headers }),
  );
}

function lockDashboard() {
  env.NODE_ENV = "production";
  env.VANOS_ACCESS_MODE = "hybrid";
  env.DASHBOARD_BASIC_USER = "jojo";
  env.DASHBOARD_BASIC_PASSWORD = "q".repeat(32);
  env.VANOS_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  env.VANOS_SESSION_SECRET = "s".repeat(32);
  delete env.VANOS_DEMO_MODE;
  delete env.VANOS_EDGE_DASHBOARD;
}

describe("demo mode", { concurrency: false }, () => {
  test("only the exact value true enables it", async () => {
    delete env.VANOS_DEMO_MODE;
    assert.equal(isDemoMode(), false);
    assert.equal(demoEndpointDisabled("POST", "/api/bots/ingest"), false);
    for (const value of ["", "1", "yes", "TRUE", "false", "on"]) {
      env.VANOS_DEMO_MODE = value;
      assert.equal(isDemoMode(), false, value || "(empty)");
    }
    env.VANOS_DEMO_MODE = "true";
    assert.equal(isDemoMode(), true);
    assert.equal(demoBanner().href, "");
  });

  test("flag off still requires dashboard auth", async () => {
    lockDashboard();
    const res = (await gate("/dashboard"));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-vanos-demo"), null);
  });

  test("demo opens the dashboard without basic auth, TOTP, or a session cookie", async () => {
    lockDashboard();
    env.VANOS_DEMO_MODE = "true";
    const res = (await gate("/dashboard"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-vanos-demo"), "true");
    assert.equal(res.headers.get("www-authenticate"), null);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  test("other flag values do not bypass auth", async () => {
    lockDashboard();
    for (const value of ["1", "yes", "TRUE"]) {
      env.VANOS_DEMO_MODE = value;
      assert.equal((await gate("/dashboard")).status, 401, value);
    }
  });

  test("demo skips the private network gate and the edge dashboard 404", async () => {
    env.NODE_ENV = "production";
    env.VANOS_DEMO_MODE = "true";
    env.VANOS_ACCESS_MODE = "private";
    env.DASHBOARD_BASIC_USER = "jojo";
    env.DASHBOARD_BASIC_PASSWORD = "q".repeat(32);
    assert.equal((await gate("/dashboard")).status, 200);

    env.VANOS_ACCESS_MODE = "edge";
    delete env.VANOS_EDGE_DASHBOARD;
    assert.equal((await gate("/dashboard")).status, 200);
    assert.equal((await gate("/")).status, 200);
    assert.equal((await gate("/api/v1/health")).status, 200);
    assert.equal((await gate("/api/v1/snapshot")).status, 404);
  });

  test("write and ingest endpoints are refused", async () => {
    lockDashboard();
    env.VANOS_DEMO_MODE = "true";
    env.BOTS_INGEST_SECRET = "c".repeat(32);
    env.AGENT_API_TOKEN = "a".repeat(32);
    const writes: Array<[string, string]> = [
      ["POST", "/api/bots/ingest"],
      ["GET", "/api/bots/ingest"],
      ["POST", "/api/bots/dispatch"],
      ["POST", "/api/costs/ingest"],
      ["POST", "/api/money/ingest"],
      ["POST", "/api/money/action"],
      ["POST", "/api/connections/ingest"],
      ["POST", "/api/mcp"],
      ["DELETE", "/api/mcp"],
      ["POST", "/api/v1/ingest"],
      ["POST", "/api/v1/sync"],
      ["GET", "/api/v1/sync"],
      ["POST", "/api/v1/dispatch"],
      ["POST", "/api/v1/homeassistant"],
      ["POST", "/api/v1/displayfusion"],
      ["POST", "/api/homeassistant"],
      ["POST", "/api/displayfusion"],
      ["POST", "/api/auth/mfa"],
    ];
    for (const [method, path] of writes) {
      const res = (await gate(path, method, {
        authorization: `Bearer ${"c".repeat(32)}`,
        "content-type": "application/json",
      }));
      assert.equal(res.status, 403, `${method} ${path}`);
      const body = (await res.json()) as { error?: string; demo?: boolean };
      assert.equal(body.demo, true, path);
      assert.match(body.error ?? "", /read-only/);
    }
    assert.equal((await gate("/api/homeassistant")).status, 200);
    assert.equal((await gate("/api/github")).status, 200);
  });

  test("ingest route does not persist and does not echo a secret", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vanos-demo-"));
    env.VANOS_DEMO_MODE = "true";
    env.BOTS_INGEST_SECRET = "c".repeat(32);
    env.BOTS_DATA_DIR = dir;
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    const secret = "super-secret-ingest-value";
    const res = await ingestPost(
      new Request("http://127.0.0.1:3000/api/bots/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"c".repeat(32)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          botId: "muddy",
          type: "status",
          title: secret,
          body: "should not be stored",
        }),
      }),
    );
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.equal(text.includes(secret), false);
    assert.deepEqual(await readdir(dir), []);
    await rm(dir, { recursive: true, force: true });
  });

  test("mfa route is refused before it can mint a session", async () => {
    lockDashboard();
    env.VANOS_DEMO_MODE = "true";
    const res = await mfaPost(
      new Request("http://127.0.0.1:3000/api/auth/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      }),
    );
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  test("integrations return sample data and do not call upstreams", async () => {
    env.VANOS_DEMO_MODE = "true";
    env.GITHUB_TOKEN = "github-token-should-not-leak";
    env.GITHUB_OWNER = "jojo-swe";
    env.NOTION_TOKEN = "notion-token-should-not-leak";
    env.NOTION_DATABASE_IDS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    env.OBSIDIAN_VAULT_PATH = "/tmp/real-vault-should-not-appear";
    env.OBSIDIAN_API_URL = "https://obsidian.internal";
    env.OBSIDIAN_API_KEY = "obsidian-key-should-not-leak";
    env.HOME_ASSISTANT_URL = "https://ha.internal.example";
    env.HOME_ASSISTANT_TOKEN = "ha-token-should-not-leak";
    env.DISPLAYFUSION_BRIDGE_URL = "http://desktop.internal:17890/run";
    env.DISPLAYFUSION_BRIDGE_SECRET = "df-secret-should-not-leak";

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("upstream");
    };

    const github = await getGithubSnapshot(fetchImpl);
    const notion = await getNotionSnapshot(fetchImpl);
    const obsidian = await getObsidianSnapshot("road", fetchImpl);
    const ha = await getHaSnapshot();
    const df = await getDfSnapshot();
    const connections = await getConnectionsSnapshot();
    assert.equal(calls, 0);
    assert.match(github.detail, /Sample data/);
    assert.equal(github.owner, "demo");
    assert.match(notion.detail, /Sample data/);
    assert.match(obsidian.detail, /Sample notes/);
    assert.equal(obsidian.notes.length, 1);
    assert.match(ha.detail, /Sample data/);
    assert.equal(ha.baseUrl, undefined);
    assert.equal(df.bridgeUrl, undefined);
    assert.equal(
      connections.connections.find((row) => row.id === "github")?.wire,
      "mcp-ready",
    );
    const blob = JSON.stringify({ github, notion, obsidian, ha, df, connections });
    assert.equal(blob.includes("should-not-leak"), false);
    assert.equal(blob.includes("real-vault"), false);
    assert.equal(blob.includes("ha.internal"), false);
    assert.equal(blob.includes("desktop.internal"), false);
  });

  test("flag off still calls GitHub", async () => {
    delete env.VANOS_DEMO_MODE;
    env.GITHUB_TOKEN = "github_pat_test_value_do_not_log";
    env.GITHUB_OWNER = "demo-owner";
    let calls = 0;
    await getGithubSnapshot(async () => {
      calls += 1;
      return new Response("{}", { status: 500 });
    });
    assert.equal(calls > 0, true);
  });

  test("setup, bot status, and the durable store ignore live secrets", async () => {
    env.VANOS_DEMO_MODE = "true";
    env.AGENT_API_TOKEN = "a".repeat(32);
    env.BOTS_INGEST_SECRET = "c".repeat(32);
    env.GITHUB_TOKEN = "github-token-should-not-leak";
    env.VANOS_PRIVATE_APP_URL = "https://secret-host.ts.net";
    env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    env.UPSTASH_REDIS_REST_TOKEN = "upstash-token-should-not-leak";
    env.GROK_BOT_DEFAULT_WEBHOOK_URL = "https://hooks.example/secret-hook";
    env.GROK_BOT_DEFAULT_WEBHOOK_KEY = "webhook-key-should-not-leak";

    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("PONG");
    };
    try {
      await durableSetJson("demo-key", { token: "upstash-token-should-not-leak" });
      const ping = await durablePing();
      const stored = await durableGetJson("demo-key");
      assert.equal(calls, 0);
      assert.equal(stored, null);
      assert.match(ping.detail, /sample data/i);

      const setup = await getSetupStatus();
      const status = await botsStatus(new Request("http://127.0.0.1:3000/api/bots/status"));
      assert.equal(status.status, 200);
      const statusJson = await status.json();
      const blob = JSON.stringify({ setup, statusJson, ping });
      assert.equal(blob.includes("should-not-leak"), false);
      assert.equal(blob.includes("secret-host"), false);
      assert.equal(blob.includes("secret-hook"), false);
      assert.equal(setup.agentApiConfigured, false);
      assert.equal(setup.ingestConfigured, false);
      assert.equal(statusJson.ingestConfigured, false);
      assert.equal(statusJson.targets.every((row: { hasKey: boolean }) => row.hasKey === false), true);
      assert.match(statusJson.state.events[0].summary, /Sample/);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("demo banner link is empty unless a public http(s) URL is configured", () => {
    env.VANOS_DEMO_MODE = "true";
    delete env.VANOS_DEMO_REPO_URL;
    assert.equal(demoBanner().href, "");
    assert.equal(demoBanner().link, "");
    env.VANOS_DEMO_REPO_URL = "https://example.com/demo";
    assert.equal(demoBanner().href, "https://example.com/demo");
    env.VANOS_DEMO_REPO_URL = "javascript:alert(1)";
    assert.equal(demoBanner().href, "");
    env.VANOS_DEMO_REPO_URL = "not a url";
    assert.equal(demoBanner().href, "");
  });
});
