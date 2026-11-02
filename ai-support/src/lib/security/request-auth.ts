import { acceptedAgentTokens, authorizeAgent } from "@/lib/agent-api/auth";
import { acceptedIngestSecrets } from "@/lib/bots/auth";
import { readBearerToken } from "./identity";
import { timingSafeEqualAny } from "./timing";

/**
 * True if the credential matches an agent token or an ingest secret,
 * including the *_PREVIOUS value while a rotation is in progress.
 * Prefer authorizeAgent / authorizeIngest for scoped routes.
 */
export function authorizeAnyAgentBearer(req: Request): boolean {
  const bearer = readBearerToken(req);
  const agentHdr = req.headers.get("x-vanos-agent-token")?.trim();
  const ingestHdr = req.headers.get("x-vanos-ingest-secret")?.trim();

  if (bearer && timingSafeEqualAny(bearer, acceptedAgentTokens())) return true;
  if (bearer && timingSafeEqualAny(bearer, acceptedIngestSecrets())) return true;
  if (agentHdr && timingSafeEqualAny(agentHdr, acceptedAgentTokens())) return true;
  if (ingestHdr && timingSafeEqualAny(ingestHdr, acceptedIngestSecrets())) {
    return true;
  }
  return false;
}

/**
 * Privileged viewer for health/discovery inventory.
 * Bearer (AGENT_API_TOKEN) only — never Tailscale headers (spoofable on public edges).
 */
export function isPrivilegedRequest(req: Request): boolean {
  return authorizeAgent(req);
}
