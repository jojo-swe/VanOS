import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  authorizeAgent,
  isAgentApiConfigured,
} from "@/lib/agent-api/auth";
import { getRateLimitPerMinute, isDemoMode } from "@/lib/security/config";
import { logAuthFail, logMissingToken, logServerError } from "@/lib/security/access-log";
import { clientIp, rateLimitConsume } from "@/lib/security/rate-limit";
import { createVanosMcpServer } from "./server";

/** Hard cap for one Streamable HTTP JSON-RPC body. */
export const MAX_MCP_BODY_BYTES = 64 * 1024;

/** Clients must accept both, per the Streamable HTTP spec. */
export const MCP_ACCEPT = "application/json, text/event-stream";

function rpcError(
  status: number,
  message: string,
  extra?: HeadersInit,
): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32001 : -32000, message },
      id: null,
    },
    { status, headers: extra },
  );
}

/**
 * Stateless Streamable HTTP MCP endpoint.
 * Auth is Bearer AGENT_API_TOKEN via authorizeAgent (constant-time compare).
 */
export async function handleMcpHttp(req: Request): Promise<Response> {
  if (isDemoMode()) return rpcError(403, "Demo mode is read-only");
  if (!isAgentApiConfigured()) {
    return rpcError(
      503,
      "Agent API not configured. Set AGENT_API_TOKEN (distinct from BOTS_INGEST_SECRET).",
    );
  }

  if (!authorizeAgent(req)) {
    logMissingToken(req);
    return rpcError(401, "Unauthorized", {
      "WWW-Authenticate": 'Bearer realm="VanOS Mission Control"',
    });
  }

  const ip = clientIp(req);
  const limit = await rateLimitConsume(`mcp:${ip}`, getRateLimitPerMinute());
  if (!limit.ok) {
    logAuthFail(req, "rate_limited");
    return rpcError(429, "Rate limit exceeded", {
      "Retry-After": String(
        Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
      ),
      "X-RateLimit-Remaining": "0",
    });
  }

  if (req.method !== "POST") {
    return rpcError(405, "Method not allowed. This MCP endpoint accepts POST.", {
      Allow: "POST",
    });
  }

  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isInteger(size) || size < 0) {
      return rpcError(400, "Invalid Content-Length");
    }
    if (size > MAX_MCP_BODY_BYTES) {
      return rpcError(
        413,
        `Payload too large (max ${MAX_MCP_BODY_BYTES} bytes)`,
      );
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_MCP_BODY_BYTES,
  });
  const server = createVanosMcpServer(req);
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-RateLimit-Remaining", String(limit.remaining));
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch (err) {
    logServerError(new URL(req.url).pathname, err);
    return rpcError(500, "MCP request failed");
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
