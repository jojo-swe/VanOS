import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_TASK_CHARS, dispatchToBot } from "@/lib/bots/dispatch";
import { getGrokBotTargets } from "@/lib/bots/config";
import { plainRecord } from "@/lib/bots/parse-ingest";
import { getBridgeState } from "@/lib/bots/store";
import { getConnectionsSnapshot } from "@/lib/connections/store";
import { categoryTotals, getCostSnapshot } from "@/lib/costs/store";
import { getDashboardData } from "@/lib/dashboard/data";
import { acceptBotIngest } from "@/lib/bots/accept";
import { isDurableWriteError } from "@/lib/durable/store";

/**
 * Read tools plus two additive creates. There is no delete, update, or
 * device-control tool on this connector.
 */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CREATE_ONLY = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Tools the public Grok connector is allowed to expose. No delete/destroy surface. */
export const PUBLIC_MCP_TOOL_NAMES = [
  "vanos_agent_status",
  "vanos_create_dispatch",
  "vanos_get_connections",
  "vanos_get_costs",
  "vanos_list_agents",
  "vanos_post_bot_event",
  "vanos_recent_bot_events",
] as const;

const DESTRUCTIVE_TOOL_NAME = /delete|remove|destroy|drop|purge|wipe/i;

export function assertPublicMcpToolsNonDestructive(
  names: readonly string[] = PUBLIC_MCP_TOOL_NAMES,
): void {
  for (const name of names) {
    if (DESTRUCTIVE_TOOL_NAME.test(name)) {
      throw new Error(
        `Public MCP connector refuses destructive tool "${name}"`,
      );
    }
  }
}

assertPublicMcpToolsNonDestructive();

const MAX_EVENTS = 50;

type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

function toolText(data: unknown, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function publicBots() {
  return getGrokBotTargets().map((bot) => ({
    id: bot.id,
    name: bot.name,
    role: bot.role,
    configured: bot.configured,
  }));
}

/**
 * Mission Control tools for one stateless MCP request.
 * Reads use the same stores as GET /api/v1/snapshot. Dispatch and bot
 * events use the same shared functions as /api/v1/dispatch and
 * /api/bots/ingest, authorized here by the agent token.
 */
export function createVanosMcpServer(req: Request): McpServer {
  const server = new McpServer(
    { name: "vanos-mission-control", version: "1.1.0" },
    {
      instructions:
        "VanOS Mission Control connector. Read tools list agents, status, costs, recent bot events, and connections. Create tools dispatch a task or post a bot event. No delete or destructive tools.",
      maxToolInputElements: 256,
    },
  );

  server.registerTool(
    "vanos_list_agents",
    {
      description:
        "List VanOS dashboard agents and Grok Bot dispatch targets. Read-only. Webhook URLs and secrets are omitted. grokBots ids are the ones vanos_create_dispatch accepts.",
      annotations: READ_ONLY,
    },
    async () => {
      const dashboard = await getDashboardData();
      return toolText({
        agents: dashboard.agents,
        grokBots: publicBots(),
      });
    },
  );

  server.registerTool(
    "vanos_agent_status",
    {
      description:
        "Read one agent's dashboard status (health, focus, last active) and the latest bot event for that id. Read-only.",
      inputSchema: {
        agentId: z
          .string()
          .describe("Dashboard agent id or bot id, for example muddy"),
      },
      annotations: READ_ONLY,
    },
    async ({ agentId }) => {
      const id = agentId.trim().toLowerCase();
      const [dashboard, bridge] = await Promise.all([
        getDashboardData(),
        getBridgeState(),
      ]);
      const agent =
        dashboard.agents.find((row) => row.id.toLowerCase() === id) ?? null;
      const latestEvent =
        Object.entries(bridge.latestByBot).find(
          ([key]) => key.toLowerCase() === id,
        )?.[1] ?? null;
      return toolText({
        found: Boolean(agent || latestEvent),
        agent,
        latestEvent,
      });
    },
  );

  server.registerTool(
    "vanos_get_costs",
    {
      description:
        "Read the Mission Control cost snapshot: budget, burn, spend lines, and daily series. Read-only. Same costs slice as GET /api/v1/snapshot.",
      annotations: READ_ONLY,
    },
    async () => {
      const costs = await getCostSnapshot();
      return toolText({
        ...costs,
        byCategoryDaily: categoryTotals(costs.lines),
      });
    },
  );

  server.registerTool(
    "vanos_recent_bot_events",
    {
      description:
        "Read recent bot events posted to Mission Control, newest first. Read-only. Does not delete events.",
      inputSchema: {
        botId: z
          .string()
          .optional()
          .describe("When set, only events for this bot id"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_EVENTS)
          .optional()
          .describe("How many events to return (default 20, max 50)"),
      },
      annotations: READ_ONLY,
    },
    async ({ botId, limit }) => {
      const state = await getBridgeState();
      const cap = limit ?? 20;
      const id = botId?.trim();
      const events = (
        id ? state.events.filter((event) => event.botId === id) : state.events
      ).slice(0, cap);
      return toolText({
        count: events.length,
        events,
      });
    },
  );

  server.registerTool(
    "vanos_get_connections",
    {
      description:
        "Read the Mission Control connections snapshot (mail, GitHub, Notion, notes, drives, and wire status). Read-only. Same connections slice as GET /api/v1/snapshot.",
      annotations: READ_ONLY,
    },
    async () => toolText(await getConnectionsSnapshot()),
  );

  server.registerTool(
    "vanos_create_dispatch",
    {
      description:
        "Create a task for one configured Grok Bot, the same as POST /api/v1/dispatch. Additive only: records a new dispatch and posts it to that bot's webhook. Does not cancel, edit, or delete dispatches.",
      inputSchema: {
        botId: z
          .string()
          .describe("Configured Grok Bot id from vanos_list_agents, for example muddy"),
        task: z
          .string()
          .describe(`Task text sent to the bot webhook (max ${MAX_TASK_CHARS} characters)`),
        context: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .optional()
          .describe("Optional flat JSON context included with the task"),
      },
      annotations: { ...CREATE_ONLY, openWorldHint: true },
    },
    async ({ botId, task, context }) => {
      // Call the shared dispatcher directly. Going through the
      // /api/v1/dispatch route failed on the edge host, where that route
      // is closed, so the tool always reported a non-JSON body there.
      try {
        const result = await dispatchToBot(
          { botId, task, context },
          { origin: new URL(req.url).origin, source: "vanos-mcp" },
        );
        if (result.kind === "rejected") return toolText({ error: result.error }, true);
        return toolText(
          { ok: result.accepted, dispatch: result.record, error: result.error },
          !result.accepted,
        );
      } catch (e) {
        if (isDurableWriteError(e)) {
          return toolText({ error: "Storage is unavailable, so nothing was saved. Try again shortly." }, true);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "vanos_post_bot_event",
    {
      description:
        "Create a bot event (status, result, or error) with the same fields as POST /api/bots/ingest. Additive only: appends an event. A repeated idempotencyKey for the same bot returns the original event. Does not edit or delete events.",
      inputSchema: {
        botId: z
          .string()
          .optional()
          .describe("Bot id, for example muddy. Required when botName is omitted"),
        botName: z
          .string()
          .optional()
          .describe("Display name. Required when botId is omitted"),
        type: z
          .enum(["status", "result", "error"])
          .describe("Event kind"),
        title: z.string().describe("Short title, 1–200 characters"),
        body: z.string().describe("What happened, 1–8000 characters"),
        links: z
          .array(
            z.object({
              url: z.string().describe("https URL"),
              label: z.string().optional().describe("Link label"),
            }),
          )
          .optional()
          .describe("Optional links"),
        metadata: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .optional()
          .describe("Flat metadata. No nested objects"),
        timestamp: z
          .string()
          .optional()
          .describe("Client event time, ISO-8601"),
        idempotencyKey: z
          .string()
          .optional()
          .describe("Replay of the same bot and key returns the original event"),
        dispatchId: z
          .string()
          .optional()
          .describe("dispatch id this event completes"),
      },
      annotations: CREATE_ONLY,
    },
    async (args) => {
      try {
        const accepted = await acceptBotIngest(plainRecord(args));
        if (!accepted.ok) return toolText(accepted.body, true);
        return toolText({ ok: true, event: accepted.event, idempotent: accepted.idempotent });
      } catch (e) {
        if (isDurableWriteError(e)) {
          return toolText({ error: "Storage is unavailable, so nothing was saved. Try again shortly." }, true);
        }
        throw e;
      }
    },
  );

  return server;
}
