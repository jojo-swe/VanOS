import { logMissingToken, noteBearerResult } from "@/lib/security/access-log";
import {
  configuredAgentTokens,
  matchesToken,
  readToken,
} from "@/lib/security/tokens";

/**
 * Agent API auth — AGENT_API_TOKEN, plus AGENT_API_TOKEN_PREVIOUS during rotation.
 * Ingest callbacks use BOTS_INGEST_SECRET via authorizeIngest (separate scope).
 *
 * Legacy: set VANOS_ALLOW_INGEST_AS_AGENT=true to accept BOTS_INGEST_SECRET
 * as the agent token when no agent token is configured (not recommended).
 */
function legacyIngestAsAgent(): boolean {
  const flag = process.env.VANOS_ALLOW_INGEST_AS_AGENT?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function acceptedAgentTokens(): string[] {
  const configured = configuredAgentTokens();
  if (configured.length > 0) return configured;
  if (!legacyIngestAsAgent()) return [];
  const fallback = readToken("BOTS_INGEST_SECRET");
  return fallback ? [fallback] : [];
}

export function getAgentToken(): string | undefined {
  return acceptedAgentTokens()[0];
}

export function isAgentApiConfigured(): boolean {
  return acceptedAgentTokens().length > 0;
}

export function authorizeAgent(req: Request): boolean {
  const expected = acceptedAgentTokens();
  if (!expected.length) return false;

  const auth = req.headers.get("authorization");
  let ok = false;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && matchesToken(token, expected)) ok = true;
  }

  if (!ok) {
    const header = req.headers.get("x-vanos-agent-token")?.trim();
    if (header && matchesToken(header, expected)) ok = true;
  }
  noteBearerResult(req, ok);
  return ok;
}

export function unauthorized(req: Request) {
  logMissingToken(req);
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function notConfigured() {
  return Response.json(
    {
      error:
        "Agent API not configured. Set AGENT_API_TOKEN (distinct from BOTS_INGEST_SECRET).",
    },
    { status: 503 },
  );
}
