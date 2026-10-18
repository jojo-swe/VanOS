import type { DashboardData, HealthStatus } from "@/lib/dashboard/types";
import type { BotBridgeState } from "./types";

function isHealth(v: unknown): v is HealthStatus {
  return v === "ok" || v === "warn" || v === "error" || v === "idle";
}

/** Overlay Grok Bot ingest onto seeded dashboard snapshot. */
export function mergeBotState(
  data: DashboardData,
  bridge: BotBridgeState,
): DashboardData {
  const agents = data.agents.map((agent) => {
    const live = bridge.latestByBot[agent.id];
    if (!live) return agent;
    return {
      ...agent,
      status: isHealth(live.status) ? live.status : agent.status,
      focus: live.focus?.trim() || live.summary?.trim() || agent.focus,
      lastActive: `${relative(live.receivedAt)} (Grok Bot)`,
    };
  });

  const liveAlerts = Object.values(bridge.latestByBot)
    .flatMap((evt) =>
      (evt.alerts ?? []).map((a, i) => ({
        id: `grok-${evt.botId}-${i}-${evt.id}`,
        severity: a.severity,
        title: `${evt.botName ?? evt.botId}: ${a.title}`,
        body: a.body,
        at: evt.receivedAt,
        section: "bots" as const,
      })),
    )
    .slice(0, 8);

  const summaryAlerts = Object.values(bridge.latestByBot)
    .filter((e) => e.summary)
    .slice(0, 4)
    .map((e) => ({
      id: `grok-sum-${e.id}`,
      severity: (isHealth(e.status) ? e.status : "ok") as HealthStatus,
      title: `${e.botName ?? e.botId} reported in`,
      body: e.summary as string,
      at: e.receivedAt,
      section: "bots" as const,
    }));

  // Ranking and the final cut happen in finishDashboard.
  const alerts = [...liveAlerts, ...summaryAlerts, ...data.alerts];

  return {
    ...data,
    generatedAt: new Date().toISOString(),
    agents,
    alerts,
  };
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 60_000)) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}
