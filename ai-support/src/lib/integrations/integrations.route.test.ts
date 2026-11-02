import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import * as githubDashboard from "@/app/api/github/route";
import * as notionDashboard from "@/app/api/notion/route";
import * as obsidianDashboard from "@/app/api/obsidian/route";
import { GET as githubV1 } from "@/app/api/v1/github/route";
import { GET as notionV1 } from "@/app/api/v1/notion/route";
import { GET as obsidianV1 } from "@/app/api/v1/obsidian/route";
import { clearIntegrationCache } from "@/lib/integrations/cache";

const AGENT = "agent-token-test-value-0123456789";
const GITHUB = "github_pat_route_test_do_not_log";
const env = process.env as Record<string, string | undefined>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function basic(path: string) {
  const encoded = Buffer.from("jojo:dashboard-password-value").toString("base64");
  return new Request(`http://127.0.0.1:3000${path}`, {
    headers: { authorization: `Basic ${encoded}` },
  });
}

function bearer(path: string, token = AGENT) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

afterEach(() => {
  delete env.DASHBOARD_BASIC_USER;
  delete env.DASHBOARD_BASIC_PASSWORD;
  delete env.AGENT_API_TOKEN;
  delete env.VANOS_ALLOW_INGEST_AS_AGENT;
  delete env.VANOS_ACCESS_MODE;
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_OWNER;
  delete env.NOTION_TOKEN;
  delete env.NOTION_DATABASE_IDS;
  delete env.OBSIDIAN_VAULT_PATH;
  delete env.OBSIDIAN_API_URL;
  delete env.OBSIDIAN_API_KEY;
  clearIntegrationCache();
});

describe("integration routes", () => {
  test("dashboard routes are read-only and require basic auth", async () => {
    assert.equal("POST" in githubDashboard, false);
    assert.equal("POST" in notionDashboard, false);
    assert.equal("POST" in obsidianDashboard, false);

    const denied = await githubDashboard.GET(new Request("http://127.0.0.1:3000/api/github"));
    assert.equal(denied.status, 401);

    env.DASHBOARD_BASIC_USER = "jojo";
    env.DASHBOARD_BASIC_PASSWORD = "dashboard-password-value";
    const github = await githubDashboard.GET(basic("/api/github"));
    const notion = await notionDashboard.GET(basic("/api/notion"));
    const obsidian = await obsidianDashboard.GET(basic("/api/obsidian"));
    assert.equal(github.status, 200);
    assert.equal(notion.status, 200);
    assert.equal(obsidian.status, 200);
    const body = (await github.json()) as { configured: boolean; status: string };
    assert.equal(body.configured, false);
    assert.equal(body.status, "idle");
  });

  test("agent routes require the agent token", async () => {
    const missing = await githubV1(bearer("/api/v1/github"));
    assert.equal(missing.status, 503);

    env.AGENT_API_TOKEN = AGENT;
    const wrong = await notionV1(bearer("/api/v1/notion", "nope"));
    assert.equal(wrong.status, 401);

    const ok = await obsidianV1(bearer("/api/v1/obsidian"));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { configured: boolean };
    assert.equal(body.configured, false);
  });

  test("the agent github route returns mocked pulls and omits the token", async () => {
    env.AGENT_API_TOKEN = AGENT;
    env.GITHUB_TOKEN = GITHUB;
    env.GITHUB_OWNER = "jojo-swe";
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.equal(url.includes(GITHUB), false);
      if (url.includes("/user/repos")) {
        return json([
          {
            name: "VanOS",
            full_name: "jojo-swe/VanOS",
            pushed_at: "2026-10-16T12:00:00Z",
            owner: { login: "jojo-swe" },
          },
        ]);
      }
      if (url.includes("/pulls")) {
        return json([
          {
            number: 4,
            title: "Read-only integrations",
            html_url: "https://github.com/jojo-swe/VanOS/pull/4",
            updated_at: "2026-10-16T12:00:00Z",
            user: { login: "jojo-swe" },
          },
        ]);
      }
      if (url.includes("/commits")) return json([]);
      if (url.includes("/actions/runs")) return json({ workflow_runs: [] });
      return json({ message: "no" }, 404);
    };
    try {
      const res = await githubV1(bearer("/api/v1/github"));
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        openPrs: { title: string }[];
        owner: string;
      };
      assert.equal(body.owner, "jojo-swe");
      assert.equal(body.openPrs[0]?.title, "Read-only integrations");
      assert.equal(JSON.stringify(body).includes(GITHUB), false);
      assert.equal(JSON.stringify(body).includes(AGENT), false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
