/**
 * Runs once when the Next.js server boots (Node and Edge).
 * Refuses to start when the agent and ingest tokens are equal or too short.
 * Next.js catches a thrown error and keeps the process up, so exit explicitly.
 * The startup line is written before that exit.
 */
export async function register() {
  const { reportStartup } = await import("@/lib/security/startup-log");
  reportStartup();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
): Promise<void> {
  const { logServerError } = await import("@/lib/security/access-log");
  logServerError(request.path, err);
}
