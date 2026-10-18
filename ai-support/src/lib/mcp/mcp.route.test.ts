import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { POST } from "@/app/api/mcp/route";
import { MAX_MCP_BODY_BYTES, MCP_ACCEPT } from "@/lib/mcp/http";
import {
  assertPublicMcpToolsNonDestructive,
  PUBLIC_MCP_TOOL_NAMES,
} from "@/lib/mcp/server";
import { classifyPath } from "@/lib/security/paths";
import { clearRateLimits } from "@/lib/security/rate-limit";

const TOKEN = "test-agent-token";

let dataDir = "";

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-mcp-"));
  process.env.AGENT_API_TOKEN = TOKEN;
  process.env.BOTS_DATA_DIR = dataDir;
  process.env.VANOS_STORE_PREFIX = `vanos-mcp-${process.pid}`;
  delete process.env.VANOS_ALLOW_INGEST_AS_AGENT;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.VANOS_RATE_LIMIT_PER_MIN;
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

function rpc(
  method: string,
  params: Record<string, unknown> | undefined,
  headers: Record<string, string> = {},
  id = 1,
) {
  return POST(
    new Request("http://127.0.0.1:3000/api/mcp", {
      method: "POST",
      headers: {
        accept: MCP_ACCEPT,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
}

const auth = { authorization: `Bearer ${TOKEN}` };

async function rpcJson(res: Response) {
  const text = await res.text();
  return JSON.parse(text) as {
    result?: {
      tools?: Array<{
        name: string;
        description?: string;
        annotations?: {
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
        };
        inputSchema?: { properties?: Record<string, unknown> };
      }>;
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    error?: { message?: string };
  };
}

describe("POST /api/mcp", { concurrency: false }, () => {
  test("auth failure", async () => {
    const missing = await rpc("tools/list", {});
    assert.equal(missing.status, 401);
    const missingJson = await rpcJson(missing);
    assert.equal(missingJson.error?.message, "Unauthorized");
    assert.match(
      missing.headers.get("www-authenticate") ?? "",
      /Bearer/,
    );

    const wrong = await rpc("tools/list", {}, {
      authorization: "Bearer not-the-token",
    });
    assert.equal(wrong.status, 401);
    const wrongJson = await rpcJson(wrong);
    assert.equal(wrongJson.error?.message, "Unauthorized");
  });

  test("tool list is read tools plus two creates", async () => {
    assert.equal(classifyPath("/api/mcp"), "public_bearer");
    assert.equal(classifyPath("/dashboard"), "private_ui");

    const res = await rpc("tools/list", {}, auth);
    assert.equal(res.status, 200);
    const json = await rpcJson(res);
    const tools = json.result?.tools ?? [];
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...PUBLIC_MCP_TOOL_NAMES]);
    assertPublicMcpToolsNonDestructive(names);

    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 20);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.readOnlyHint === true || tool.annotations?.readOnlyHint === false, true);
      assert.doesNotMatch(tool.name, /delete|remove|destroy|drop|purge|wipe/i);
    }

    const reads = tools.filter((tool) => tool.annotations?.readOnlyHint === true);
    assert.equal(reads.length, 5);
    const creates = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
    assert.deepEqual(
      creates.map((tool) => tool.name).sort(),
      ["vanos_create_dispatch", "vanos_post_bot_event"],
    );
    assert.ok(creates.every((tool) => tool.annotations?.destructiveHint === false));
    assert.ok(tools.find((tool) => tool.name === "vanos_post_bot_event")?.inputSchema?.properties?.type);
    assert.ok(tools.find((tool) => tool.name === "vanos_create_dispatch")?.inputSchema?.properties?.task);
  });

  test("dispatch works on the edge host and calls back to /api/bots/ingest", async () => {
    const keys = [
      "VANOS_ACCESS_MODE",
      "GROK_BOT_MUDDY_WEBHOOK_URL",
      "GROK_BOT_MUDDY_WEBHOOK_KEY",
      "VANOS_PUBLIC_INGEST_URL",
      "VANOS_PUBLIC_API_BASE",
      "VANOS_API_BASE",
    ] as const;
    const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const realFetch = globalThis.fetch;
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    process.env.VANOS_ACCESS_MODE = "edge";
    process.env.GROK_BOT_MUDDY_WEBHOOK_URL = "http://203.0.113.10/hook/muddy";
    process.env.GROK_BOT_MUDDY_WEBHOOK_KEY = "k".repeat(32);
    for (const k of ["VANOS_PUBLIC_INGEST_URL", "VANOS_PUBLIC_API_BASE", "VANOS_API_BASE"]) {
      delete process.env[k];
    }
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const res = await rpc(
        "tools/call",
        { name: "vanos_create_dispatch", arguments: { botId: "muddy", task: "Check the build" } },
        auth,
        9,
      );
      assert.equal(res.status, 200);
      const json = await rpcJson(res);
      assert.equal(json.result?.isError, false, json.result?.content?.[0]?.text);
      const data = JSON.parse(json.result?.content?.[0]?.text ?? "{}") as {
        ok: boolean;
        dispatch: { botId: string; accepted: boolean };
      };
      assert.equal(data.ok, true);
      assert.equal(data.dispatch.botId, "muddy");
      assert.equal(sent.length, 1);
      const callback = sent[0]?.body.callback as { url: string; auth: string };
      assert.equal(callback.url, "http://127.0.0.1:3000/api/bots/ingest");
      assert.match(callback.auth, /BOTS_INGEST_SECRET/);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of keys) {
        if (before[k] === undefined) delete process.env[k];
        else process.env[k] = before[k];
      }
    }
  });

  test("read tool lists agents", async () => {
    const res = await rpc(
      "tools/call",
      { name: "vanos_list_agents", arguments: {} },
      auth,
      2,
    );
    assert.equal(res.status, 200);
    const json = await rpcJson(res);
    assert.equal(json.result?.isError, false);
    const text = json.result?.content?.[0]?.text ?? "";
    const data = JSON.parse(text) as {
      agents: Array<{ id: string }>;
      grokBots: Array<{ id: string; webhookUrl?: string }>;
    };
    assert.ok(data.agents.some((agent) => agent.id === "muddy"));
    assert.ok(data.grokBots.some((bot) => bot.id === "muddy"));
    assert.ok(
      data.grokBots.every(
        (bot) => !("webhookUrl" in bot) && !("webhookKey" in bot),
      ),
    );
  });

  test("create tool posts a bot event", async () => {
    const res = await rpc(
      "tools/call",
      {
        name: "vanos_post_bot_event",
        arguments: {
          botId: "muddy",
          botName: "Muddy",
          type: "status",
          title: "Connector check",
          body: "Posted through the MCP create tool.",
          idempotencyKey: "mcp-create-1",
        },
      },
      auth,
      3,
    );
    assert.equal(res.status, 200);
    const json = await rpcJson(res);
    assert.notEqual(json.result?.isError, true);
    const text = json.result?.content?.[0]?.text ?? "";
    const data = JSON.parse(text) as {
      ok: boolean;
      idempotent: boolean;
      event: { id: string; botId: string; type: string; title: string };
    };
    assert.equal(data.ok, true);
    assert.equal(data.idempotent, false);
    assert.equal(data.event.botId, "muddy");
    assert.equal(data.event.type, "status");
    assert.equal(data.event.title, "Connector check");
    assert.ok(data.event.id.startsWith("evt_"));
  });

  test("rate limit", async () => {
    clearRateLimits();
    process.env.VANOS_RATE_LIMIT_PER_MIN = "2";
    const headers = { ...auth, "x-forwarded-for": "198.51.100.50" };
    try {
      assert.equal((await rpc("tools/list", {}, headers, 5)).status, 200);
      assert.equal((await rpc("tools/list", {}, headers, 6)).status, 200);
      const blocked = await rpc("tools/list", {}, headers, 7);
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get("retry-after"));
    } finally {
      delete process.env.VANOS_RATE_LIMIT_PER_MIN;
    }
  });

  test("oversized body is rejected", async () => {
    const pad = "x".repeat(MAX_MCP_BODY_BYTES);
    const res = await POST(
      new Request("http://127.0.0.1:3000/api/mcp", {
        method: "POST",
        headers: {
          ...auth,
          accept: MCP_ACCEPT,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.11",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: { pad },
        }),
      }),
    );
    assert.equal(res.status, 413);
  });
});
