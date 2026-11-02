import { NextResponse } from "next/server";
import { getHaSnapshot, runHaService } from "@/lib/homeassistant/store";
import { isHaServiceAllowed } from "@/lib/homeassistant/config";
import { authorizeDashboardOrAgent } from "@/lib/security/dashboard-auth";
import { guardBasicAuthMutation } from "@/lib/security/csrf";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  if (!authorizeDashboardOrAgent(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const snapshot = await getHaSnapshot();
  return NextResponse.json({
    ...snapshot,
    // never echo token
    docs: "HOME-LAB.md",
  });
}

/** POST { domain, service, entityId?, data?, reportedBy? } */
export const POST = withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  const blocked = guardBasicAuthMutation(req);
  if (blocked) return blocked;

  const read = await readJsonObject(req);
  if (!read.ok) return read.response;
  const body: unknown = read.value;

  const raw = (body ?? {}) as Record<string, unknown>;
  const domain = typeof raw.domain === "string" ? raw.domain : "";
  const service = typeof raw.service === "string" ? raw.service : "";
  if (!domain || !service) {
    return NextResponse.json(
      { error: "domain and service are required" },
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
      target:
        raw.target && typeof raw.target === "object" && !Array.isArray(raw.target)
          ? (raw.target as Record<string, unknown>)
          : undefined,
    },
    typeof raw.reportedBy === "string" ? raw.reportedBy : "dashboard",
  );

  return NextResponse.json({
    ok: result.call.ok,
    call: result.call,
    snapshot: result.snapshot,
  });
});
