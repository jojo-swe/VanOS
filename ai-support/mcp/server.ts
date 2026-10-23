#!/usr/bin/env node
/**
 * VanOS Mission Control MCP server (stdio).
 *
 * Env:
 *   VANOS_API_BASE   — e.g. http://127.0.0.1:3000  (no trailing slash)
 *   AGENT_API_TOKEN  — or BOTS_INGEST_SECRET
 *
 * Cursor mcp.json example:
 * {
 *   "mcpServers": {
 *     "vanos": {
 *       "command": "npx",
 *       "args": ["tsx", "mcp/server.ts"],
 *       "cwd": "/path/to/VanOS/ai-support",
 *       "env": {
 *         "VANOS_API_BASE": "http://127.0.0.1:3000",
 *         "AGENT_API_TOKEN": "…"
 *       }
 *     }
 *   }
 * }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const base = (process.env.VANOS_API_BASE ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const token =
  process.env.AGENT_API_TOKEN?.trim() ||
  process.env.BOTS_INGEST_SECRET?.trim() ||
  "";

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${base}${path}`, { ...init, headers });
  let json: unknown = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function textResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

const server = new McpServer({
  name: "vanos-mission-control",
  version: "1.0.0",
});

server.registerTool(
  "vanos_health",
  {
    description: "Check VanOS Mission Control Agent API health (no auth required).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/health");
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_snapshot",
  {
    description:
      "Full Mission Control snapshot: dashboard, costs, money, connections, bots. Requires agent token.",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/snapshot");
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_ingest",
  {
    description:
      "Write into Mission Control. domain=bots|costs|money|connections plus domain fields (e.g. botId/summary for bots, lines[] for costs).",
    inputSchema: z.object({
      domain: z.enum(["bots", "costs", "money", "connections"]),
      payload: z
        .record(z.string(), z.unknown())
        .describe("Domain-specific fields merged with domain"),
    }),
  },
  async ({ domain, payload }) => {
    const body = { domain, ...payload };
    const res = await api("/api/v1/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_bot_heartbeat",
  {
    description:
      "Quick bots-domain heartbeat: update an agent's status/focus/summary on the dashboard.",
    inputSchema: z.object({
      botId: z.string().describe("e.g. muddy, elon, gary, warren"),
      botName: z.string().optional(),
      status: z.enum(["ok", "warn", "error", "idle"]).optional(),
      focus: z.string().optional(),
      summary: z.string().optional(),
    }),
  },
  async (args) => {
    const res = await api("/api/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ domain: "bots", ...args }),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_dispatch",
  {
    description:
      "Dispatch a task to a Grok Bot routine webhook via Mission Control.",
    inputSchema: z.object({
      botId: z.string(),
      task: z.string(),
      context: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  async ({ botId, task, context }) => {
    const res = await api("/api/v1/dispatch", {
      method: "POST",
      body: JSON.stringify({ botId, task, context }),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_get_costs",
  {
    description: "Get costs snapshot only (from full snapshot).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/snapshot");
    if (!res.ok) return textResult(res.json, true);
    const snap = res.json as { costs?: unknown };
    return textResult(snap.costs ?? res.json);
  },
);

server.registerTool(
  "vanos_get_money",
  {
    description: "Get money snapshot (subs, everyday, tax, sell).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/snapshot");
    if (!res.ok) return textResult(res.json, true);
    const snap = res.json as { money?: unknown };
    return textResult(snap.money ?? res.json);
  },
);

server.registerTool(
  "vanos_get_connections",
  {
    description: "Get connections snapshot (mail, github, notion, joplin, drive).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/snapshot");
    if (!res.ok) return textResult(res.json, true);
    const snap = res.json as { connections?: unknown };
    return textResult(snap.connections ?? res.json);
  },
);

server.registerTool(
  "vanos_sync_digest",
  {
    description:
      "Post a daily/hourly digest to Mission Control (n8n/Grok/OpenClaw sync). Optionally fan out domain ingests via domains{}.",
    inputSchema: z.object({
      source: z.enum(["n8n", "grok", "openclaw", "hermes", "manual", "cron"]),
      summary: z.string().optional(),
      period: z.enum(["daily", "hourly", "manual"]).optional(),
      date: z.string().optional().describe("YYYY-MM-DD UTC"),
      domains: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional bots|costs|money|connections payloads"),
      reportedBy: z.string().optional(),
    }),
  },
  async (args) => {
    const res = await api("/api/v1/sync", {
      method: "POST",
      body: JSON.stringify(args),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_setup_status",
  {
    description:
      "Wire checklist: token, durable store, Grok webhooks, last digest (no secrets).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/setup");
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_ha_states",
  {
    description: "Home Assistant watched entity states (via Mission Control).",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/homeassistant");
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_ha_call",
  {
    description:
      "Call a Home Assistant service, e.g. domain=light service=toggle entityId=light.desk.",
    inputSchema: z.object({
      domain: z.string(),
      service: z.string(),
      entityId: z.string().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  async (args) => {
    const res = await api("/api/v1/homeassistant", {
      method: "POST",
      body: JSON.stringify({ ...args, reportedBy: "mcp" }),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_df_run",
  {
    description:
      "Run a DisplayFusion script/function on Jojo's Windows PC via the Tailscale bridge.",
    inputSchema: z.object({
      scriptId: z.string().optional(),
      command: z.string().optional(),
      functionName: z.string().optional(),
      args: z.array(z.string()).optional(),
    }),
  },
  async (args) => {
    const res = await api("/api/v1/displayfusion", {
      method: "POST",
      body: JSON.stringify({ ...args, reportedBy: "mcp" }),
    });
    return textResult(res.json, !res.ok);
  },
);

server.registerTool(
  "vanos_df_list",
  {
    description: "List DisplayFusion scripts registered in Mission Control.",
    inputSchema: z.object({}),
  },
  async () => {
    const res = await api("/api/v1/displayfusion");
    return textResult(res.json, !res.ok);
  },
);

async function main() {
  if (!token) {
    console.error(
      "[vanos-mcp] Warning: AGENT_API_TOKEN / BOTS_INGEST_SECRET not set — authenticated tools will fail.",
    );
  }
  console.error(`[vanos-mcp] Connecting to ${base}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[vanos-mcp] Fatal:", err);
  process.exit(1);
});
