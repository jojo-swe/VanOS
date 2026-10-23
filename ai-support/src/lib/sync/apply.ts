import { parseBoardIngest } from "@/lib/board/parse-ingest";
import { applyBoardIngest } from "@/lib/board/store";
import { acceptBotIngest } from "@/lib/bots/accept";
import { parseConnectionsIngest } from "@/lib/connections/parse-ingest";
import { applyConnectionsIngest } from "@/lib/connections/store";
import { parseCostIngest } from "@/lib/costs/parse-ingest";
import { applyCostIngest } from "@/lib/costs/store";
import { isDurableWriteError } from "@/lib/durable/store";
import { parseMoneyIngest } from "@/lib/money/parse-ingest";
import { applyMoneyIngest } from "@/lib/money/store";
import { isSyncSource, recordDigest } from "./store";
import type {
  SyncDigestPayload,
  SyncDigestRecord,
  SyncDomain,
} from "./types";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const BOT_EVENT_KEYS = ["type", "title", "body"];

/**
 * Store a bots heartbeat or event through the same checks as
 * /api/bots/ingest. Defaults: botId "mission", and for a heartbeat status
 * "ok" plus a summary naming the digest.
 */
async function applyBotsDomain(
  raw: Record<string, unknown>,
  reportedBy?: string,
): Promise<void> {
  const input: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(raw)) input[key] = raw[key];
  if (input.botId === undefined && input.bot_id === undefined) input.botId = "mission";
  const isEvent = BOT_EVENT_KEYS.some((k) => k in input);
  if (!isEvent) {
    if (input.status === undefined) input.status = "ok";
    if (input.summary === undefined) {
      input.summary = `Digest sync${reportedBy ? ` from ${reportedBy}` : ""}`;
    }
  }
  const accepted = await acceptBotIngest(input);
  if (!accepted.ok) throw new Error(String(accepted.body.error ?? "bots ingest rejected"));
}

function parsedOrThrow<T>(result: { ok: true; payload: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

/**
 * Apply a daily/hourly digest: optionally fan out domain ingests, then record sync.
 */
export async function applyDigest(
  payload: SyncDigestPayload,
): Promise<SyncDigestRecord> {
  if (!isSyncSource(payload.source)) {
    throw new Error(
      "source is required: n8n | grok | openclaw | hermes | manual | cron",
    );
  }

  const domainsApplied: SyncDomain[] = [];
  const domainErrors: Partial<Record<SyncDomain, string>> = {};
  const reportedBy =
    payload.reportedBy?.trim() ||
    `${payload.source}-digest`;

  const domains = payload.domains ?? {};

  if (domains.bots) {
    try {
      await applyBotsDomain(domains.bots, reportedBy);
      domainsApplied.push("bots");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.bots = e instanceof Error ? e.message : "bots failed";
    }
  }

  if (domains.costs) {
    try {
      await applyCostIngest(parsedOrThrow(parseCostIngest({ ...domains.costs, reportedBy })));
      domainsApplied.push("costs");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.costs = e instanceof Error ? e.message : "costs failed";
    }
  }

  if (domains.money) {
    try {
      await applyMoneyIngest(parsedOrThrow(parseMoneyIngest({ ...domains.money, reportedBy })));
      domainsApplied.push("money");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.money = e instanceof Error ? e.message : "money failed";
    }
  }

  if (domains.connections) {
    try {
      await applyConnectionsIngest(
        parsedOrThrow(parseConnectionsIngest({ ...domains.connections, reportedBy })),
      );
      domainsApplied.push("connections");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.connections =
        e instanceof Error ? e.message : "connections failed";
    }
  }

  if (domains.board) {
    try {
      const parsed = parseBoardIngest({ ...domains.board, reportedBy });
      if (!parsed.ok) throw new Error(parsed.error);
      await applyBoardIngest(parsed.payload);
      domainsApplied.push("board");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.board = e instanceof Error ? e.message : "board failed";
    }
  }

  // Always leave a bots heartbeat when source is grok/n8n and no bots domain
  if (!domains.bots && (payload.source === "grok" || payload.source === "n8n")) {
    try {
      await applyBotsDomain(
        {
          botId: payload.source === "grok" ? "mission" : "muddy",
          botName: payload.source === "grok" ? "Mission Control" : "Muddy",
          status: "ok",
          summary:
            payload.summary?.trim() ||
            `Daily digest from ${payload.source}`,
        },
        reportedBy,
      );
      domainsApplied.push("bots");
    } catch (e) {
      if (isDurableWriteError(e)) throw e;
      domainErrors.bots = e instanceof Error ? e.message : "bots heartbeat failed";
    }
  }

  return recordDigest({
    source: payload.source,
    date: payload.date?.trim() || todayUtc(),
    period: payload.period ?? "daily",
    summary: payload.summary,
    reportedBy,
    domainsApplied,
    domainErrors:
      Object.keys(domainErrors).length > 0 ? domainErrors : undefined,
    meta: payload.meta,
  });
}
