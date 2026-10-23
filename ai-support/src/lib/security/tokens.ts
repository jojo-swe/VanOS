import { timingSafeEqualAny } from "./timing";

/** openssl rand -base64 32 is 44 characters. Shorter shared secrets are refused. */
export const MIN_TOKEN_LENGTH = 32;

const AGENT = "AGENT_API_TOKEN";
const AGENT_PREVIOUS = "AGENT_API_TOKEN_PREVIOUS";
const INGEST = "BOTS_INGEST_SECRET";
const INGEST_PREVIOUS = "BOTS_INGEST_SECRET_PREVIOUS";

export function readToken(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function unique(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Current agent token, then the rotation previous. No ingest fallback. */
export function configuredAgentTokens(): string[] {
  return unique([readToken(AGENT), readToken(AGENT_PREVIOUS)]);
}

/** Current ingest secret, then the rotation previous. */
export function configuredIngestSecrets(): string[] {
  return unique([readToken(INGEST), readToken(INGEST_PREVIOUS)]);
}

export function matchesToken(presented: string, expected: readonly string[]): boolean {
  return timingSafeEqualAny(presented, expected);
}

/**
 * Problems that must abort process startup.
 * Unset tokens are allowed (routes return 503). A token that is set and
 * shorter than MIN_TOKEN_LENGTH, or any pair that collapses the agent/ingest
 * split, is fatal. Messages never include the secret values.
 */
export function tokenProblems(): string[] {
  const agent = readToken(AGENT);
  const agentPrev = readToken(AGENT_PREVIOUS);
  const ingest = readToken(INGEST);
  const ingestPrev = readToken(INGEST_PREVIOUS);
  const problems: string[] = [];

  const checkLength = (name: string, value: string | undefined) => {
    if (value && value.length < MIN_TOKEN_LENGTH) {
      problems.push(`${name} is shorter than ${MIN_TOKEN_LENGTH} characters`);
    }
  };
  checkLength(AGENT, agent);
  checkLength(AGENT_PREVIOUS, agentPrev);
  checkLength(INGEST, ingest);
  checkLength(INGEST_PREVIOUS, ingestPrev);

  const pairs: Array<[string, string | undefined, string, string | undefined]> = [
    [AGENT, agent, INGEST, ingest],
    [AGENT, agent, INGEST_PREVIOUS, ingestPrev],
    [AGENT_PREVIOUS, agentPrev, INGEST, ingest],
    [AGENT_PREVIOUS, agentPrev, INGEST_PREVIOUS, ingestPrev],
  ];
  for (const [leftName, left, rightName, right] of pairs) {
    if (left && right && left === right) {
      problems.push(`${leftName} must not equal ${rightName}`);
    }
  }

  return problems;
}

/**
 * A configured dashboard password must meet the same length as bearer tokens.
 * Unset is allowed. This is reported at startup; it does not replace the
 * token separation check.
 */
export function dashboardPasswordProblems(): string[] {
  const pass = process.env.DASHBOARD_BASIC_PASSWORD?.trim();
  if (!pass || pass.length >= MIN_TOKEN_LENGTH) return [];
  return [`DASHBOARD_BASIC_PASSWORD is shorter than ${MIN_TOKEN_LENGTH} characters`];
}

export function assertTokenSeparation(): void {
  const problems = tokenProblems();
  if (problems.length === 0) return;
  const message = `Refusing to start: ${problems.join("; ")}`;
  console.error(`[vanos] ${message}`);
  throw new Error(message);
}
