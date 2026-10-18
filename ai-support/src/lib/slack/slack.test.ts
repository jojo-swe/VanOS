import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { GET as slackRoute } from "@/app/api/slack/route";
import { acceptBotIngest } from "@/lib/bots/accept";
import { dispatchToBot } from "@/lib/bots/dispatch";
import { applyConnectionsIngest, getConnectionsSnapshot } from "@/lib/connections/store";
import { durableSetJson } from "@/lib/durable/store";
import { clearIntegrationCache } from "@/lib/integrations/cache";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { getSlackWebhookUrl } from "./config";
import { escapeSlack, slackToPlain } from "./format";
import { clearSlackNotifyState, notifySlack, slackPayload } from "./notify";
import { getSlackSnapshot } from "./snapshot";

const TOKEN = "xoxb-test-token-do-not-log-1234";
const HOOK = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_DEMO_MODE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_IDS",
  "SLACK_WEBHOOK_URL",
  "SLACK_NOTIFY",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "AGENT_API_TOKEN",
  "GROK_BOT_MUDDY_WEBHOOK_URL",
  "GROK_BOT_MUDDY_WEBHOOK_KEY",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];
const realFetch = globalThis.fetch;
let dataDir = "";
let run = 0;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-slack-"));
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearIntegrationCache();
  clearSlackNotifyState();
  clearRateLimits();
});

function fresh() {
  delete env.VANOS_DEMO_MODE;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  for (const key of ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_IDS", "SLACK_WEBHOOK_URL", "SLACK_NOTIFY"]) delete env[key];
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  env.VANOS_STORE_PREFIX = `slack-${Date.now()}-${run++}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Capture webhook posts made through the global fetch. */
function captureWebhook(status = 200) {
  const posts: Array<{ url: string; text: string }> = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    posts.push({ url: String(url), text: (JSON.parse(String(init?.body)) as { text: string }).text });
    return new Response("ok", { status });
  }) as typeof fetch;
  return posts;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("slack config and formatting", () => {
  test("only hooks.slack.com incoming-webhook URLs are accepted", () => {
    fresh();
    env.SLACK_WEBHOOK_URL = HOOK;
    assert.equal(getSlackWebhookUrl(), HOOK);
    for (const bad of [
      "http://hooks.slack.com/services/T/B/x",
      "https://evil.example/services/T/B/x",
      "https://hooks.slack.com.evil.example/services/x",
      "https://user:pw@hooks.slack.com/services/T/B/x",
      "https://hooks.slack.com/other/x",
    ]) {
      env.SLACK_WEBHOOK_URL = bad;
      assert.equal(getSlackWebhookUrl(), undefined, bad);
    }
  });

  test("outgoing text is escaped so bots cannot ping @channel or hide links", () => {
    assert.equal(escapeSlack("<!channel> <https://x|y> & co"), "&lt;!channel&gt; &lt;https://x|y&gt; &amp; co");
    const payload = slackPayload({ severity: "error", title: "<!here> down", body: "<@U1>", source: "bot" });
    assert.ok(!payload.text.includes("<!here>"));
    assert.ok(!payload.text.includes("<@U1>"));
  });

  test("incoming Slack markup becomes plain text", () => {
    assert.equal(
      slackToPlain("Hi <@U1>, see <#C2|general> and <https://a.example|the doc> &amp; <!here>", { U1: "Jojo" }),
      "Hi @Jojo, see #general and the doc & @here",
    );
  });
});

describe("slack panel", () => {
  test("stays off without a token and does not call Slack", async () => {
    fresh();
    let called = false;
    const snap = await getSlackSnapshot(async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snap.configured, false);
    assert.equal(snap.status, "idle");
  });

  test("asks for channel ids when only the token is set", async () => {
    fresh();
    env.SLACK_BOT_TOKEN = TOKEN;
    const snap = await getSlackSnapshot(async () => json({}));
    assert.equal(snap.status, "warn");
    assert.match(snap.detail, /SLACK_CHANNEL_IDS/);
  });

  test("loads channels, resolves names, links messages and keeps the token out", async () => {
    fresh();
    env.SLACK_BOT_TOKEN = TOKEN;
    env.SLACK_CHANNEL_IDS = "C0AAAAAAA, #not-an-id, C0BBBBBBB";
    const seen: string[] = [];
    const fake = (async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url));
      seen.push(u.pathname);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
      const method = u.pathname.split("/").pop();
      const channel = u.searchParams.get("channel");
      if (method === "auth.test") return json({ ok: true, url: "https://vanos.slack.com/", team: "VanOS" });
      if (method === "conversations.info") return json({ ok: true, channel: { id: channel, name: channel === "C0AAAAAAA" ? "ops" : "alerts" } });
      if (method === "conversations.history" && channel === "C0BBBBBBB") return json({ ok: false, error: "not_in_channel" });
      if (method === "conversations.history") {
        return json({
          ok: true,
          messages: [
            { ts: "1760000000.000200", user: "U1", text: "Deploy done <@U1> &amp; tested", reply_count: 2 },
            { ts: "1760000001.000100", subtype: "channel_join", user: "U2", text: "joined" },
            { ts: "1760000002.000100", bot_id: "B1", bot_profile: { name: "Muddy" }, text: "<!channel> heads up" },
          ],
        });
      }
      if (method === "users.info") return json({ ok: true, user: { profile: { display_name: "Jojo" } } });
      return json({ ok: false, error: "unknown_method" });
    }) as typeof fetch;

    const snap = await getSlackSnapshot(fake);
    assert.equal(snap.configured, true);
    assert.equal(snap.status, "warn");
    assert.equal(snap.workspace, "VanOS");
    assert.equal(snap.channels.length, 2);
    const ops = snap.channels.find((c) => c.name === "ops");
    assert.ok(ops);
    assert.equal(ops.messages.length, 2);
    assert.equal(ops.messages[0]?.author, "Jojo");
    assert.equal(ops.messages[0]?.text, "Deploy done @Jojo & tested");
    assert.equal(ops.messages[0]?.replies, 2);
    assert.equal(ops.messages[0]?.url, "https://vanos.slack.com/archives/C0AAAAAAA/p1760000000000200");
    assert.equal(ops.messages[1]?.author, "Muddy");
    assert.match(snap.channels.find((c) => c.name === "alerts")?.error ?? "", /invite/i);
    assert.equal(JSON.stringify(snap).includes(TOKEN), false);

    const again = await getSlackSnapshot(fake);
    assert.equal(again.cached, true);
  });

  test("a rejected token is an error with a readable message", async () => {
    fresh();
    env.SLACK_BOT_TOKEN = TOKEN;
    env.SLACK_CHANNEL_IDS = "C0AAAAAAA";
    const snap = await getSlackSnapshot((async () => json({ ok: false, error: "invalid_auth" })) as typeof fetch);
    assert.equal(snap.status, "error");
    assert.match(snap.detail, /SLACK_BOT_TOKEN/);
  });

  test("the dashboard route needs credentials", async () => {
    fresh();
    env.NODE_ENV = "production";
    env.DASHBOARD_BASIC_USER = "jojo";
    env.DASHBOARD_BASIC_PASSWORD = "p".repeat(32);
    const res = await slackRoute(new Request("http://127.0.0.1:3000/api/slack"));
    assert.equal(res.status, 401);
  });
});

describe("slack notifications", () => {
  test("posts once per notice, caps the rate, and never throws", async () => {
    fresh();
    env.SLACK_WEBHOOK_URL = HOOK;
    const posts = captureWebhook();
    assert.equal(await notifySlack({ severity: "error", title: "A" }), true);
    assert.equal(await notifySlack({ severity: "error", title: "A" }), false);
    for (let i = 0; i < 30; i++) await notifySlack({ severity: "error", title: `n${i}` });
    assert.equal(posts.length, 20);
    assert.equal(posts[0]?.url, HOOK);

    clearSlackNotifyState();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    assert.equal(await notifySlack({ severity: "error", title: "B" }), false);
  });

  test("off without a webhook, with SLACK_NOTIFY=off, and in demo mode", async () => {
    fresh();
    const posts = captureWebhook();
    assert.equal(await notifySlack({ severity: "error", title: "x" }), false);
    env.SLACK_WEBHOOK_URL = HOOK;
    env.SLACK_NOTIFY = "off";
    assert.equal(await notifySlack({ severity: "error", title: "y" }), false);
    delete env.SLACK_NOTIFY;
    env.VANOS_DEMO_MODE = "true";
    assert.equal(await notifySlack({ severity: "error", title: "z" }), false);
    assert.equal(posts.length, 0);
  });

  test("a bot error event notifies; ok events and replays do not", async () => {
    fresh();
    env.SLACK_WEBHOOK_URL = HOOK;
    const posts = captureWebhook();

    const ok = await acceptBotIngest({ botId: "muddy", type: "status", title: "All good", body: "fine" });
    assert.equal(ok.ok, true);
    const bad = await acceptBotIngest(
      { botId: "muddy", botName: "Muddy", type: "error", title: "Build broke <!channel>", body: "npm ci failed" },
      { idempotencyKeyHeader: "err-1" },
    );
    assert.equal(bad.ok, true);
    await acceptBotIngest(
      { botId: "muddy", botName: "Muddy", type: "error", title: "Build broke <!channel>", body: "npm ci failed" },
      { idempotencyKeyHeader: "err-1" },
    );
    await settle();
    assert.equal(posts.length, 1);
    assert.match(posts[0]?.text ?? "", /Build broke/);
    assert.ok(!posts[0]?.text.includes("<!channel>"));
  });

  test("SLACK_NOTIFY=all also sends finished results", async () => {
    fresh();
    env.SLACK_WEBHOOK_URL = HOOK;
    env.SLACK_NOTIFY = "all";
    const posts = captureWebhook();
    await acceptBotIngest({ botId: "muddy", type: "result", title: "Report ready", body: "Done" });
    await settle();
    assert.equal(posts.length, 1);
  });

  test("a dispatch the bot does not accept notifies", async () => {
    fresh();
    env.SLACK_WEBHOOK_URL = HOOK;
    env.GROK_BOT_MUDDY_WEBHOOK_URL = "http://203.0.113.10/hook/muddy";
    env.GROK_BOT_MUDDY_WEBHOOK_KEY = "k".repeat(32);
    const posts: string[] = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith("https://hooks.slack.com/")) {
        posts.push((JSON.parse(String(init?.body)) as { text: string }).text);
        return new Response("ok", { status: 200 });
      }
      return new Response("paused", { status: 503 });
    }) as typeof fetch;
    const result = await dispatchToBot({ botId: "muddy", task: "Check CI" }, { origin: "http://127.0.0.1:3000", source: "test" });
    assert.equal(result.kind, "sent");
    await settle();
    assert.equal(posts.length, 1);
    assert.match(posts[0] ?? "", /Dispatch to .* failed/);
  });
});

describe("slack as a connection", () => {
  test("shows as live when configured and accepts agent status updates", async () => {
    fresh();
    // An overlay stored before Slack existed must not block a Slack update.
    await durableSetJson("connections-overlay", {
      updatedAt: new Date().toISOString(),
      connections: [{ id: "github", name: "GitHub", kind: "code", wire: "live", detail: "x", mcpAvailable: true }],
    });
    let snap = await getConnectionsSnapshot();
    assert.equal(snap.connections.find((c) => c.id === "slack")?.wire, "missing");

    env.SLACK_WEBHOOK_URL = HOOK;
    snap = await getConnectionsSnapshot();
    assert.equal(snap.connections.find((c) => c.id === "slack")?.wire, "live");

    await applyConnectionsIngest({
      reportedBy: "muddy",
      connections: [{ id: "slack", wire: "error", detail: "Bot was removed from #ops" }],
    });
    snap = await getConnectionsSnapshot();
    const slack = snap.connections.find((c) => c.id === "slack");
    assert.equal(slack?.wire, "error");
    assert.equal(slack?.detail, "Bot was removed from #ops");
  });
});
