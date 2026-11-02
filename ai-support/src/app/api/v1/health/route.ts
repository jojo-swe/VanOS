import { NextResponse } from "next/server";
import { isAgentApiConfigured } from "@/lib/agent-api/auth";
import { isIngestConfigured } from "@/lib/bots/config";
import { getGrokBotTargets } from "@/lib/bots/config";
import { durablePing, getDurableBackend } from "@/lib/durable/store";
import { getAccessMode, securitySummary } from "@/lib/security/config";
import { isPrivilegedRequest } from "@/lib/security/request-auth";
import { getSyncState, hoursSince } from "@/lib/sync/store";
import { getBridgeState } from "@/lib/bots/store";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";

export const GET = withRequestLog(async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  const privileged = isPrivilegedRequest(req);

  // Sparse public response — no config inventory for scanners
  if (!privileged) {
    return NextResponse.json({
      ok: true,
      service: "vanos-mission-control",
      time: new Date().toISOString(),
    });
  }

  const targets = getGrokBotTargets();
  const [durable, sync, bridge] = await Promise.all([
    durablePing(),
    getSyncState(),
    getBridgeState(),
  ]);
  const last = sync.lastDaily ?? sync.digests[0];
  const lastBotEvent = bridge.events[0];

  return NextResponse.json({
    ok: true,
    service: "vanos-mission-control",
    version: "1",
    time: new Date().toISOString(),
    accessMode: getAccessMode(),
    security: securitySummary(),
    agentApiConfigured: isAgentApiConfigured(),
    ingestConfigured: isIngestConfigured(),
    grokBotsConfigured: targets.filter((t) => t.configured).length,
    grokBotsTotal: targets.length,
    durableBackend: getDurableBackend(),
    durableOk: durable.ok,
    lastDigestAt: last?.receivedAt ?? null,
    hoursSinceLastDigest: hoursSince(last?.receivedAt),
    lastGrokIngestAt: lastBotEvent?.receivedAt ?? null,
    hoursSinceLastGrokIngest: hoursSince(lastBotEvent?.receivedAt),
  });
});
