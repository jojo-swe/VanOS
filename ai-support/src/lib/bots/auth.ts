import { noteBearerResult } from "@/lib/security/access-log";
import { matchesToken, configuredIngestSecrets } from "@/lib/security/tokens";

/**
 * Ingest-only auth: BOTS_INGEST_SECRET, plus BOTS_INGEST_SECRET_PREVIOUS
 * while a rotation is in progress.
 * Does not accept AGENT_API_TOKEN (narrow blast radius).
 */
export function acceptedIngestSecrets(): string[] {
  return configuredIngestSecrets();
}

export function authorizeIngest(req: Request): boolean {
  const expected = acceptedIngestSecrets();
  if (!expected.length) return false;

  const auth = req.headers.get("authorization");
  let ok = false;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && matchesToken(token, expected)) ok = true;
  }

  if (!ok) {
    const header = req.headers.get("x-vanos-ingest-secret")?.trim();
    if (header && matchesToken(header, expected)) ok = true;
  }
  noteBearerResult(req, ok);
  return ok;
}
