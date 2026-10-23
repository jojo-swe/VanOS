import { NextResponse } from "next/server";
import {
  authorizeAgent,
  isAgentApiConfigured,
  notConfigured,
  unauthorized,
} from "@/lib/agent-api/auth";
import { applyDigest } from "@/lib/sync/apply";
import { getSyncState, isSyncSource } from "@/lib/sync/store";
import type { SyncDigestPayload, SyncDomain } from "@/lib/sync/types";
import { logServerError, withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { isDurableWriteError } from "@/lib/durable/store";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

/**
 * Daily / hourly agent digest sync.
 *
 * POST { source, summary?, period?, date?, domains?: { bots|costs|money|connections } }
 * GET  → recent digests (auth required)
 */
export const POST = withRequestLog(withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);

  const read = await readJsonObject(req, 256 * 1024);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;
  if (!isSyncSource(raw.source)) {
    return NextResponse.json(
      {
        error:
          "source is required: 'n8n' | 'grok' | 'openclaw' | 'hermes' | 'manual' | 'cron'",
      },
      { status: 400 },
    );
  }

  const domainsRaw = raw.domains;
  let domains: SyncDigestPayload["domains"];
  if (domainsRaw && typeof domainsRaw === "object" && !Array.isArray(domainsRaw)) {
    domains = {};
    for (const key of ["bots", "costs", "money", "connections", "board"] as SyncDomain[]) {
      const v = (domainsRaw as Record<string, unknown>)[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        domains[key] = v as Record<string, unknown>;
      }
    }
  }

  const payload: SyncDigestPayload = {
    source: raw.source,
    date: typeof raw.date === "string" ? raw.date : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    period:
      raw.period === "hourly" || raw.period === "manual" || raw.period === "daily"
        ? raw.period
        : "daily",
    domains,
    reportedBy:
      typeof raw.reportedBy === "string" ? raw.reportedBy : undefined,
    meta:
      raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)
        ? (raw.meta as Record<string, string | number | boolean>)
        : undefined,
  };

  try {
    const digest = await applyDigest(payload);
    return NextResponse.json({ ok: true, digest });
  } catch (e) {
    if (isDurableWriteError(e)) throw e;
    logServerError(new URL(req.url).pathname, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}));

export const GET = withRequestLog(async function GET(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);

  const state = await getSyncState();
  return NextResponse.json({
    ok: true,
    updatedAt: state.updatedAt,
    lastDaily: state.lastDaily ?? null,
    digests: state.digests.slice(0, 20),
  });
});
