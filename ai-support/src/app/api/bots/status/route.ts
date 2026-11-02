import { NextResponse } from "next/server";
import {
  getGrokBotTargets,
  isIngestConfigured,
  publicTargetView,
} from "@/lib/bots/config";
import { getBridgeState } from "@/lib/bots/store";
import type { BotBridgeStatusResponse } from "@/lib/bots/types";
import { denyDashboardRead } from "@/lib/security/dashboard-auth";
import { isDemoMode } from "@/lib/security/config";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

/** Short routine brief — full mental model: GROK-PROMPT.md */
const ROUTINE_PROMPT = `You are a VanOS Mission Control agent. Dashboard dispatches work to you via webhook; you report back via ingest.

Set up a webhook routine named "Mission Control dispatch".

When the webhook fires:
1. Read JSON: source, botId, botName, dispatchId, task, context, callback.
2. Do "task" with your tools (HTTP 200 on webhook = started, not finished).
3. When done OR blocked, POST to callback.url with:
   Authorization: Bearer <ask Jojo for BOTS_INGEST_SECRET — not AGENT_API_TOKEN>
   Content-Type: application/json
   Idempotency-Key: <dispatchId or another stable key>
   {
     "botId": "<same botId>",
     "botName": "<your name>",
     "dispatchId": "<same dispatchId>",
     "type": "result",
     "title": "one-line result",
     "body": "what you did or why blocked",
     "timestamp": "<ISO-8601 now>"
   }
4. type must be "status" | "result" | "error". Use "error" when blocked. Always ingest something.
5. Never put secrets or private memory in title/body/metadata.
6. Optional (only if task asks): costs → POST /api/costs/ingest; money → /api/money/ingest; connections → /api/connections/ingest (same ingest Bearer).

After setup, give Jojo this routine's POST URL + key for GROK_BOT_*_WEBHOOK_URL / _KEY.`;

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed("/api/bots/status");
  if (edgeDenied) return edgeDenied;
  const unauthorized = denyDashboardRead(req);
  if (unauthorized) return unauthorized;
  if (isDemoMode()) {
    const payload: BotBridgeStatusResponse = {
      targets: publicTargetView(getGrokBotTargets()),
      ingestConfigured: false,
      ingestUrlPath: "/api/bots/ingest",
      state: await getBridgeState(),
      setup: {
        routinePrompt: "Demo mode does not dispatch to Grok or accept ingest.",
        ingestExample: '{ "demo": true }',
      },
    };
    return NextResponse.json(payload);
  }
  const targets = getGrokBotTargets();
  const state = await getBridgeState();

  const payload: BotBridgeStatusResponse = {
    targets: publicTargetView(targets),
    ingestConfigured: isIngestConfigured(),
    ingestUrlPath: "/api/bots/ingest",
    state,
    setup: {
      routinePrompt: ROUTINE_PROMPT,
      ingestExample: JSON.stringify(
        {
          botId: "muddy",
          botName: "Muddy",
          type: "status",
          title: "Triaging Mission Control alerts",
          body: "Reviewed pulse. Radar cron still failing.",
          timestamp: new Date().toISOString(),
          links: [],
          metadata: { source: "routine" },
        },
        null,
        2,
      ),
    },
  };

  return NextResponse.json(payload);
}
