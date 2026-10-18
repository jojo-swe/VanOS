import { NextResponse } from "next/server";
import {
  authorizeAgent,
  isAgentApiConfigured,
  notConfigured,
  unauthorized,
} from "@/lib/agent-api/auth";
import { getHaSnapshot, runHaService } from "@/lib/homeassistant/store";
import { isHaServiceAllowed } from "@/lib/homeassistant/config";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

export const GET = withRequestLog(async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!isAgentApiConfigured()) return notConfigured();
  if (!authorizeAgent(req)) return unauthorized(req);
  return NextResponse.json(await getHaSnapshot());
});

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
  if (raw.action === "states" || raw.action === "snapshot") {
    return NextResponse.json(await getHaSnapshot());
  }

  const domain = typeof raw.domain === "string" ? raw.domain : "";
  const service = typeof raw.service === "string" ? raw.service : "";
  if (!domain || !service) {
    return NextResponse.json(
      { error: "domain and service required (or action: states)" },
      { status: 400 },
    );
  }
  if (!isHaServiceAllowed(domain, service)) {
    return NextResponse.json(
      { error: "Service is not in HA_ALLOWED_SERVICES" },
      { status: 403 },
    );
  }

  const result = await runHaService(
    {
      domain,
      service,
      entityId: typeof raw.entityId === "string" ? raw.entityId : undefined,
      data:
        raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
          ? (raw.data as Record<string, unknown>)
          : undefined,
    },
    typeof raw.reportedBy === "string" ? raw.reportedBy : "agent-api",
  );

  return NextResponse.json({
    ok: result.call.ok,
    call: result.call,
    snapshot: result.snapshot,
  });
}));
