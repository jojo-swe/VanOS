import { NextResponse } from "next/server";
import { MONEY_ACTION_MAX_BYTES, parseMoneyAction } from "@/lib/money/actions";
import { runMoneyAction } from "@/lib/money/store";
import { guardBasicAuthMutation } from "@/lib/security/csrf";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";
import { withDurableErrors } from "@/lib/durable/respond";
import { readJsonObject } from "@/lib/http/json-body";

export const dynamic = "force-dynamic";

const KIND_NAME = { subscription: "subscription", everyday: "bill", sell: "item for sale" } as const;

/**
 * One-tap money actions from the dashboard.
 * Body: { kind: "subscription" | "everyday" | "sell", id, action }
 *   subscription: cancel · everyday (bills): mark-paid · sell: sold, mark-paid
 *
 * Dashboard basic auth or session (JSON, same origin), or AGENT_API_TOKEN.
 * Private UI path: closed on the edge, refused in demo mode.
 */
export const POST = withDurableErrors(async function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  const blocked = guardBasicAuthMutation(req);
  if (blocked) return blocked;

  const read = await readJsonObject(req, MONEY_ACTION_MAX_BYTES);
  if (!read.ok) return read.response;

  const parsed = parseMoneyAction(read.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { kind, id, action } = parsed.request;

  const outcome = await runMoneyAction(parsed.request);
  if (outcome.status === "not-found") {
    return NextResponse.json({ error: `No ${KIND_NAME[kind]} with id "${id}"` }, { status: 404 });
  }
  if (outcome.status === "invalid") {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    changed: outcome.status === "changed",
    kind,
    id,
    action,
    row: outcome.row,
  });
});
