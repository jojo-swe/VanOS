/**
 * Minimal Upstash Redis REST client. No Node imports, so the proxy (Edge
 * runtime) can use it as well as route handlers.
 */

export function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

/** Key prefix shared by every VanOS document and counter. */
export function storePrefix(): string {
  return process.env.VANOS_STORE_PREFIX?.trim() || "vanos";
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Run one Redis command. Throws on HTTP errors, Redis errors and timeouts. */
export async function upstashCommand<T = unknown>(
  cmd: (string | number)[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`Upstash: ${json.error.slice(0, 200)}`);
  return (json.result ?? null) as T | null;
}
