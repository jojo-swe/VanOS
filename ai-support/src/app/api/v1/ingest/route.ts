import { NextResponse } from "next/server";
import {
  authorizeAgent,
  isAgentApiConfigured,
  notConfigured,
  unauthorized,
} from "@/lib/agent-api/auth";
import { parseBoardIngest } from "@/lib/board/parse-ingest";
import { applyBoardIngest } from "@/lib/board/store";
import { acceptBotIngest } from "@/lib/bots/accept";
import { parseConnectionsIngest } from "@/lib/connections/parse-ingest";
import { applyConnectionsIngest } from "@/lib/connections/store";
import { parseCostIngest } from "@/lib/costs/parse-ingest";
import { applyCostIngest } from "@/lib/costs/store";
import { parseMoneyIngest } from "@/lib/money/parse-ingest";
import { applyMoneyIngest } from "@/lib/money/store";
import { logServerError, withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { isDurableWriteError } from "@/lib/durable/store";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

type Domain = "bots" | "costs" | "money" | "connections" | "board";

/**
 * Unified agent write endpoint.
 *
 * { "domain": "bots"|"costs"|"money"|"connections"|"board", ...domainFields }
 *
 * Or shorthand for bots heartbeat:
 * { "domain": "bots", "botId": "muddy", "summary": "..." }
 */
export const POST = withRequestLog(withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;
  const domain = (raw.domain ?? raw.domainName) as Domain | undefined;

  if (
    domain !== "bots" &&
    domain !== "costs" &&
    domain !== "money" &&
    domain !== "connections" &&
    domain !== "board"
  ) {
    return NextResponse.json(
      {
        error:
          "domain is required: 'bots' | 'costs' | 'money' | 'connections' | 'board'",
      },
      { status: 400 },
    );
  }

  try {
    const rest: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(raw)) {
      if (key !== "domain" && key !== "domainName") rest[key] = raw[key];
    }

    if (domain === "bots") {
      // Same path as /api/bots/ingest: size cap, strict schema, per-bot limit.
      const accepted = await acceptBotIngest(rest, {
        idempotencyKeyHeader: req.headers.get("idempotency-key"),
      });
      if (!accepted.ok) {
        return NextResponse.json(accepted.body, {
          status: accepted.status,
          headers: accepted.headers,
        });
      }
      return NextResponse.json({
        ok: true,
        domain,
        event: accepted.event,
        idempotent: accepted.idempotent,
      });
    }

    if (domain === "costs") {
      const parsed = parseCostIngest(rest);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const snapshot = await applyCostIngest(parsed.payload);
      return NextResponse.json({ ok: true, domain, snapshot });
    }

    if (domain === "money") {
      const parsed = parseMoneyIngest(rest);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const snapshot = await applyMoneyIngest(parsed.payload);
      return NextResponse.json({ ok: true, domain, snapshot });
    }

    if (domain === "board") {
      const parsed = parseBoardIngest(rest);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const board = await applyBoardIngest(parsed.payload);
      return NextResponse.json({ ok: true, domain, board });
    }

    const parsed = parseConnectionsIngest(rest);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const snapshot = await applyConnectionsIngest(parsed.payload);
    return NextResponse.json({ ok: true, domain, snapshot });
  } catch (e) {
    if (isDurableWriteError(e)) throw e;
    logServerError(new URL(req.url).pathname, e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Ingest failed",
      },
      { status: 500 },
    );
  }
}));
