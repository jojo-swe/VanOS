import { NextResponse } from "next/server";
import { isAgentApiConfigured } from "@/lib/agent-api/auth";
import { getAccessMode } from "@/lib/security/config";
import { isPrivilegedRequest } from "@/lib/security/request-auth";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

/** Agent API discovery — full catalog only for privileged callers. */
export const GET = withRequestLog(async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isPrivilegedRequest(req)) {
    return NextResponse.json({
      name: "VanOS Mission Control Agent API",
      version: "1",
      auth: "Authorization: Bearer <token>",
    });
  }

  return NextResponse.json({
    name: "VanOS Mission Control Agent API",
    version: "1",
    configured: isAgentApiConfigured(),
    accessMode: getAccessMode(),
    auth: "Authorization: Bearer $AGENT_API_TOKEN",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/health",
        auth: "sparse public; full with AGENT_API_TOKEN",
        description: "Liveness (+ config when privileged)",
      },
      {
        method: "GET",
        path: "/api/v1/snapshot",
        auth: true,
        description:
          "Full Mission Control snapshot (dashboard, costs, money, connections, bots)",
      },
      {
        method: "POST",
        path: "/api/v1/ingest",
        auth: true,
        description:
          "Unified write. Body: { domain: 'bots'|'costs'|'money'|'connections', ...payload }",
      },
      {
        method: "POST",
        path: "/api/v1/dispatch",
        auth: true,
        description:
          "Dispatch task to a Grok Bot webhook. Body: { botId, task, context? }",
      },
      {
        method: "POST",
        path: "/api/v1/sync",
        auth: true,
        description:
          "Daily digest sync. Body: { source, summary?, period?, domains? }. See AGENT-SYNC.md",
      },
      {
        method: "GET",
        path: "/api/v1/sync",
        auth: true,
        description: "Recent digests",
      },
      {
        method: "GET|POST",
        path: "/api/v1/homeassistant",
        auth: true,
        description:
          "HA states (GET) or call service (POST { domain, service, entityId? })",
      },
      {
        method: "GET|POST",
        path: "/api/v1/displayfusion",
        auth: true,
        description:
          "List DF scripts (GET) or run (POST { scriptId|command|functionName })",
      },
      {
        method: "GET",
        path: "/api/v1/github",
        auth: true,
        description: "Open PRs, latest commits, and failing workflow runs (read-only)",
      },
      {
        method: "GET",
        path: "/api/v1/notion",
        auth: true,
        description: "Open Notion database rows (Status ≠ Klart by default)",
      },
      {
        method: "GET",
        path: "/api/v1/obsidian",
        auth: true,
        description: "Recent Obsidian notes, or ?q= search",
      },
      {
        method: "GET",
        path: "/api/v1/slack",
        auth: true,
        description: "Recent messages from the configured Slack channels (read-only)",
      },
    ],
    mcp: {
      command: "npm run mcp",
      cwd: "ai-support",
      env: ["VANOS_API_BASE", "AGENT_API_TOKEN"],
      docs: "AGENT-API.md",
      http: {
        method: "POST",
        path: "/api/mcp",
        transport: "streamable-http",
        auth: "Authorization: Bearer $AGENT_API_TOKEN",
      },
    },
    setup: {
      path: "/api/setup",
      docs: "AGENT-SYNC.md",
    },
    security: {
      docs: "SECURITY.md",
    },
  });
});
