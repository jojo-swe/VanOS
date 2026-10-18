import { isDemoMode } from "@/lib/security/config";
import type { GrokBotTarget } from "./types";

const DEFAULT_BOTS: Array<Pick<GrokBotTarget, "id" | "name" | "role">> = [
  { id: "muddy", name: "Muddy", role: "COO — triage & orchestration" },
  { id: "elon", name: "Elon", role: "CTO — engineering & infra" },
  { id: "gary", name: "Gary", role: "CMO — content & brand" },
  { id: "warren", name: "Warren", role: "CRO — revenue & growth" },
  { id: "mission", name: "Mission Control", role: "Catch-all ops Bot" },
];

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Uppercase id for env keys: muddy → MUDDY */
function envId(id: string) {
  return id.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

/**
 * Resolve Grok Bot webhook targets from env.
 *
 * Per-bot:
 *   GROK_BOT_MUDDY_WEBHOOK_URL
 *   GROK_BOT_MUDDY_WEBHOOK_KEY
 *
 * Default fallback for any bot without its own URL:
 *   GROK_BOT_DEFAULT_WEBHOOK_URL
 *   GROK_BOT_DEFAULT_WEBHOOK_KEY
 *
 * Optional JSON override (array of { id, name?, role?, webhookUrl, webhookKey }):
 *   GROK_BOT_WEBHOOKS_JSON
 */
export function getGrokBotTargets(): GrokBotTarget[] {
  if (isDemoMode()) {
    return DEFAULT_BOTS.map((bot) => ({
      ...bot,
      webhookUrl: "",
      webhookKey: "",
      configured: false,
    }));
  }
  const defaults = {
    url: env("GROK_BOT_DEFAULT_WEBHOOK_URL"),
    key: env("GROK_BOT_DEFAULT_WEBHOOK_KEY"),
  };

  let extras: Array<{
    id: string;
    name?: string;
    role?: string;
    webhookUrl?: string;
    webhookKey?: string;
  }> = [];

  const rawJson = env("GROK_BOT_WEBHOOKS_JSON");
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (Array.isArray(parsed)) extras = parsed;
    } catch {
      // ignore malformed JSON — surface via empty configured list
    }
  }

  const byId = new Map<string, GrokBotTarget>();

  for (const base of DEFAULT_BOTS) {
    const idKey = envId(base.id);
    const url =
      env(`GROK_BOT_${idKey}_WEBHOOK_URL`) ?? defaults.url ?? "";
    const key =
      env(`GROK_BOT_${idKey}_WEBHOOK_KEY`) ?? defaults.key ?? "";
    byId.set(base.id, {
      ...base,
      webhookUrl: url,
      webhookKey: key,
      configured: Boolean(url && key),
    });
  }

  for (const row of extras) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    const url = row.webhookUrl ?? prev?.webhookUrl ?? defaults.url ?? "";
    const key = row.webhookKey ?? prev?.webhookKey ?? defaults.key ?? "";
    byId.set(row.id, {
      id: row.id,
      name: row.name ?? prev?.name ?? row.id,
      role: row.role ?? prev?.role ?? "Custom Bot",
      webhookUrl: url,
      webhookKey: key,
      configured: Boolean(url && key),
    });
  }

  return Array.from(byId.values());
}

export function getIngestSecret(): string | undefined {
  return env("BOTS_INGEST_SECRET");
}

export function isIngestConfigured(): boolean {
  return Boolean(getIngestSecret() || env("BOTS_INGEST_SECRET_PREVIOUS"));
}

export function publicTargetView(targets: GrokBotTarget[]) {
  return targets.map(({ id, name, role, configured, webhookKey }) => ({
    id,
    name,
    role,
    configured,
    hasKey: Boolean(webhookKey),
  }));
}
