import { isAgentApiConfigured } from "@/lib/agent-api/auth";
import { getBridgeState } from "@/lib/bots/store";
import {
  getGrokBotTargets,
  isIngestConfigured,
} from "@/lib/bots/config";
import { durablePing, getDurableBackend } from "@/lib/durable/store";
import { isGithubConfigured } from "@/lib/github/config";
import { isNotionConfigured } from "@/lib/notion/config";
import {
  getSlackChannelIds,
  getSlackNotifyLevel,
  isSlackConfigured,
  slackNotificationsEnabled,
  slackWebhookInvalid,
} from "@/lib/slack/config";
import { isObsidianConfigured } from "@/lib/obsidian/config";
import {
  getAccessMode,
  getAllowedTailscaleUsers,
  getEdgeSecret,
  getPrivateAppUrl,
  getPublicIngestBaseUrl,
  isDashboardAuthConfigured,
  isPublicIngestEnabled,
  isDemoMode,
  requireBasicAuth,
  securitySummary,
  totpEnabled,
  trustTailscaleCgnat,
} from "@/lib/security/config";
import { getSyncState, hoursSince } from "./store";
import type { SetupCheckItem, SetupStatus } from "./types";

function demoSetupStatus(): SetupStatus {
  const mode = getAccessMode();
  const checks: SetupCheckItem[] = [
    {
      id: "demo",
      label: "Demo mode",
      ok: true,
      detail:
        "VANOS_DEMO_MODE=true. Sample data only. Sign-in, live integrations, and writes are off.",
      severity: "ok",
    },
    {
      id: "writes",
      label: "Writes and ingest",
      ok: true,
      detail: "Disabled. POST /api/bots/ingest and the other write routes return 403.",
      severity: "idle",
    },
  ];
  return {
    updatedAt: new Date().toISOString(),
    agentApiConfigured: false,
    ingestConfigured: false,
    durableBackend: "memory+file",
    durableOk: true,
    durableDetail: "Demo mode uses sample data only",
    grokBotsConfigured: 0,
    grokBotsTotal: 5,
    dashboardAuthConfigured: false,
    accessMode: mode,
    security: {
      mode,
      basicAuthConfigured: false,
      requireBasicAuth: false,
      requireNetworkGate: false,
      publicIngest: false,
      trustTailscaleCgnat: false,
      edgeSecretConfigured: false,
      allowedTailscaleUsers: 0,
      allowedHosts: 0,
      privateAppUrl: null,
      publicIngestUrl: null,
    },
    hoursSinceLastDigest: null,
    hoursSinceLastGrokIngest: null,
    lastGrokIngestAt: null,
    checks,
    endpoints: {
      digest: "/api/v1/sync",
      snapshot: "/api/v1/snapshot",
      health: "/api/v1/health",
      setup: "/api/setup",
    },
    cronHint: "Writes are disabled in demo mode.",
  };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  if (isDemoMode()) return demoSetupStatus();
  const [durable, sync, bridge] = await Promise.all([
    durablePing(),
    getSyncState(),
    getBridgeState(),
  ]);
  const targets = getGrokBotTargets();
  const grokConfigured = targets.filter((t) => t.configured).length;
  const agentOk = isAgentApiConfigured();
  const ingestOk = isIngestConfigured();
  const authOk = isDashboardAuthConfigured();
  const mode = getAccessMode();
  const sec = securitySummary();

  const last = sync.lastDaily ?? sync.digests[0] ?? undefined;
  const hrs = hoursSince(last?.receivedAt);
  const lastGrok = bridge.events[0]?.receivedAt ?? null;
  const hrsGrok = hoursSince(lastGrok ?? undefined);

  const networkReady =
    Boolean(getEdgeSecret()) ||
    getAllowedTailscaleUsers().length > 0 ||
    trustTailscaleCgnat() ||
    Boolean(getPrivateAppUrl());

  const checks: SetupCheckItem[] = [
    {
      id: "access-mode",
      label: "Access mode",
      ok: mode === "hybrid" || mode === "private" || mode === "edge",
      detail: `VANOS_ACCESS_MODE=${mode}${
        mode === "public"
          ? " — not recommended for production"
          : mode === "private"
            ? " — dashboard behind basic auth and Tailscale/CGNAT"
            : mode === "edge"
              ? " — public surface is /api/bots/ingest, /api/mcp, and /api/v1/health"
              : " — UI basic-auth; wider bearer surface (prefer edge on Vercel)"
      }`,
      severity: mode === "public" ? "warn" : "ok",
    },
    {
      id: "agent-token",
      label: "AGENT_API_TOKEN",
      ok: agentOk,
      detail: agentOk
        ? "Bearer token ready for /api/v1/* and MCP"
        : "Set AGENT_API_TOKEN (or BOTS_INGEST_SECRET fallback)",
      severity: agentOk ? "ok" : "error",
    },
    {
      id: "ingest-secret",
      label: "BOTS_INGEST_SECRET",
      ok: ingestOk,
      detail: ingestOk
        ? "Legacy domain ingest + Grok callbacks authorized"
        : "Recommended for Grok Bot callbacks (or use AGENT_API_TOKEN on ingest)",
      severity: ingestOk ? "ok" : agentOk ? "warn" : "error",
    },
    {
      id: "totp",
      label: "Dashboard TOTP",
      ok: true,
      detail: totpEnabled()
        ? "VANOS_TOTP_SECRET is set. Basic auth still runs, then a 6-digit code or a recovery code."
        : "Unset. Dashboard login stays basic auth only.",
      severity: totpEnabled() ? "ok" : "idle",
    },
    {
      id: "dashboard-auth",
      label: "Dashboard basic auth",
      ok: authOk,
      detail: authOk
        ? "DASHBOARD_BASIC_USER/PASSWORD set"
        : requireBasicAuth()
          ? "REQUIRED — set DASHBOARD_BASIC_USER + DASHBOARD_BASIC_PASSWORD"
          : "Optional in public mode",
      severity: authOk ? "ok" : requireBasicAuth() ? "error" : "idle",
    },
    {
      id: "network-gate",
      label: "Tailscale / edge gate",
      ok: mode !== "private" || networkReady,
      detail:
        mode === "private"
          ? networkReady
            ? `Private mode — edge secret ${getEdgeSecret() ? "set" : "off"}, allowlist ${getAllowedTailscaleUsers().length} user(s), CGNAT trust ${trustTailscaleCgnat() ? "on" : "off"}, private URL ${getPrivateAppUrl() ?? "unset"}`
            : "Private mode needs VANOS_EDGE_SECRET, VANOS_ALLOWED_TAILSCALE_USERS, and/or VANOS_TRUST_TAILSCALE_CGNAT=true on the VPS"
          : mode === "edge"
            ? "Edge mode does not serve the dashboard"
            : `Not required in ${mode} mode (set VANOS_ACCESS_MODE=private on the VPS)`,
      severity:
        mode === "private"
          ? networkReady
            ? "ok"
            : "error"
          : "idle",
    },
    {
      id: "public-ingest",
      label: "Public ingest path",
      ok: isPublicIngestEnabled() && agentOk,
      detail: isPublicIngestEnabled()
        ? `Bearer ingest open for Grok/n8n${
            getPublicIngestBaseUrl()
              ? ` — ${getPublicIngestBaseUrl()}`
              : " — set VANOS_PUBLIC_INGEST_URL for docs"
          }`
        : "VANOS_PUBLIC_INGEST=false — Grok must reach you via Tailscale Funnel or same tailnet",
      severity: isPublicIngestEnabled()
        ? agentOk
          ? "ok"
          : "warn"
        : "warn",
    },
    {
      id: "durable",
      label: "Durable store",
      ok: durable.ok,
      detail: `${durable.backend} — ${durable.detail}`,
      severity: durable.ok
        ? durable.backend === "upstash"
          ? "ok"
          : "warn"
        : "error",
    },
    {
      id: "grok-webhooks",
      label: "Grok Bot webhooks",
      ok: grokConfigured > 0,
      detail:
        grokConfigured > 0
          ? `${grokConfigured}/${targets.length} bots have URL + key`
          : "Add GROK_BOT_*_WEBHOOK_URL / _KEY (or DEFAULT)",
      severity: grokConfigured > 0 ? "ok" : "warn",
    },
    {
      id: "daily-digest",
      label: "Daily digest sync",
      ok: hrs != null && hrs < 36,
      detail:
        last
          ? `Last ${last.source} digest ${new Date(last.receivedAt).toLocaleString()}${
              last.summary ? ` — ${last.summary}` : ""
            }`
          : "No digest yet — wire n8n/Grok cron → POST /api/v1/sync",
      severity:
        hrs == null ? "idle" : hrs < 36 ? "ok" : hrs < 72 ? "warn" : "error",
    },
    {
      id: "github-integration",
      label: "GitHub (optional)",
      ok: isGithubConfigured(),
      detail: isGithubConfigured()
        ? `Read-only API for ${process.env.GITHUB_OWNER?.trim() || "jojo-swe"}`
        : "Off until GITHUB_TOKEN is set. Also set GITHUB_OWNER.",
      severity: isGithubConfigured() ? "ok" : "idle",
    },
    {
      id: "notion-integration",
      label: "Notion (optional)",
      ok: isNotionConfigured(),
      detail: isNotionConfigured()
        ? "Internal integration reading open database rows"
        : "Off until NOTION_TOKEN and NOTION_DATABASE_IDS are set.",
      severity: isNotionConfigured() ? "ok" : "idle",
    },
    {
      id: "slack-integration",
      label: "Slack panel (optional)",
      ok: isSlackConfigured(),
      detail: isSlackConfigured()
        ? `Read-only bot token for ${getSlackChannelIds().length} channel(s)`
        : "Off until SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS are set.",
      severity: isSlackConfigured() ? "ok" : "idle",
    },
    {
      id: "slack-notifications",
      label: "Slack notifications (optional)",
      ok: slackNotificationsEnabled(),
      detail: slackWebhookInvalid()
        ? "SLACK_WEBHOOK_URL must be a https://hooks.slack.com/services/… URL."
        : slackNotificationsEnabled()
          ? `Incoming webhook on (${getSlackNotifyLevel()})`
          : "Off until SLACK_WEBHOOK_URL is set.",
      severity: slackWebhookInvalid() ? "warn" : slackNotificationsEnabled() ? "ok" : "idle",
    },
    {
      id: "obsidian-integration",
      label: "Obsidian (optional)",
      ok: isObsidianConfigured(),
      detail: isObsidianConfigured()
        ? "Vault path and/or Local REST API"
        : "Off until OBSIDIAN_VAULT_PATH or OBSIDIAN_API_URL + OBSIDIAN_API_KEY is set.",
      severity: isObsidianConfigured() ? "ok" : "idle",
    },
    {
      id: "grok-callback",
      label: "Last Grok / bot ingest",
      ok: hrsGrok != null && hrsGrok < 48,
      detail: lastGrok
        ? `Last bot ingest ${new Date(lastGrok).toLocaleString()}`
        : "No bot ingest yet — Grok routines should POST /api/bots/ingest or /api/v1/ingest",
      severity:
        hrsGrok == null
          ? "idle"
          : hrsGrok < 48
            ? "ok"
            : hrsGrok < 168
              ? "warn"
              : "error",
    },
  ];

  const publicBase = getPublicIngestBaseUrl() || "$HOST";

  return {
    updatedAt: new Date().toISOString(),
    agentApiConfigured: agentOk,
    ingestConfigured: ingestOk,
    durableBackend: getDurableBackend(),
    durableOk: durable.ok,
    durableDetail: durable.detail,
    grokBotsConfigured: grokConfigured,
    grokBotsTotal: targets.length,
    dashboardAuthConfigured: authOk,
    accessMode: mode,
    security: sec,
    lastDigest: last
      ? {
          id: last.id,
          source: last.source,
          receivedAt: last.receivedAt,
          date: last.date,
          summary: last.summary,
        }
      : undefined,
    lastGrokIngestAt: lastGrok,
    hoursSinceLastDigest: hrs,
    hoursSinceLastGrokIngest: hrsGrok,
    checks,
    endpoints: {
      digest: "/api/v1/sync",
      snapshot: "/api/v1/snapshot",
      health: "/api/v1/health",
      setup: "/api/setup",
    },
    cronHint: `0 7 * * * curl -sS -X POST "${publicBase}/api/v1/sync" -H "Authorization: Bearer $AGENT_API_TOKEN" -H "Content-Type: application/json" -d '{"source":"n8n","period":"daily","summary":"Morning digest"}'`,
  };
}
