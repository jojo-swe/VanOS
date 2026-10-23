import { handleMcpHttp } from "@/lib/mcp/http";
import { withRequestLog } from "@/lib/security/access-log";
import { denyIfDemoRequest } from "@/lib/demo/mode";
import { denyIfEdgeClosed } from "@/lib/security/edge-deny";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Grok Bot connector: stateless Streamable HTTP MCP. */
export const POST = withRequestLog(function POST(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  return handleMcpHttp(req);
});

export const GET = withRequestLog(function GET(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  return handleMcpHttp(req);
});

export const DELETE = withRequestLog(function DELETE(req: Request) {
  const demoDenied = denyIfDemoRequest(req);
  if (demoDenied) return demoDenied;
  const edgeDenied = denyIfEdgeClosed(new URL(req.url).pathname);
  if (edgeDenied) return edgeDenied;
  return handleMcpHttp(req);
});
