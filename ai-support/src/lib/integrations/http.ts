export interface TimedResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Strip bearer values, URL userinfo, and known secrets from text we might show or log. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "[redacted-url]";
    }
  });
  for (const secret of secrets) {
    if (secret.length >= 6 && out.includes(secret)) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out.slice(0, 240);
}

export function upstreamMessage(
  json: unknown,
  text: string,
  secrets: readonly string[],
): string {
  let message = text;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const msg = (json as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) message = msg.trim();
  }
  const clean = scrubSecrets(message, secrets).trim();
  return clean || "Request failed";
}

function failureMessage(err: unknown, secrets: readonly string[]): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "Timed out waiting for the upstream API";
  }
  const message = err instanceof Error ? err.message : "Request failed";
  return scrubSecrets(message, secrets) || "Request failed";
}

export interface TimedFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  timeoutMs?: number;
  secrets?: readonly string[];
  allowHosts?: readonly string[];
  hops?: number;
}

/**
 * Server-side fetch with a timeout. Redirects stay on the same host.
 * The Authorization header is never forwarded to another origin.
 */
export async function timedFetch(
  url: string,
  init: TimedFetchInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TimedResponse> {
  const secrets = init.secrets ?? [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, json: null, text: "Invalid URL" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, status: 0, json: null, text: "Refused URL with embedded credentials" };
  }
  if (init.allowHosts && !init.allowHosts.includes(parsed.hostname)) {
    return { ok: false, status: 0, json: null, text: "Refused host" };
  }

  try {
    const res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 8_000),
    });

    if (REDIRECTS.has(res.status)) {
      if ((init.hops ?? 0) >= 1) {
        return { ok: false, status: res.status, json: null, text: "Too many redirects" };
      }
      const location = res.headers.get("location");
      if (!location) {
        return { ok: false, status: res.status, json: null, text: "Redirect with no location" };
      }
      const next = new URL(location, url);
      if (next.origin !== parsed.origin) {
        return { ok: false, status: res.status, json: null, text: "Refused cross-origin redirect" };
      }
      return timedFetch(next.toString(), { ...init, hops: (init.hops ?? 0) + 1 }, fetchImpl);
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: scrubSecrets(text, secrets),
    };
  } catch (err) {
    return { ok: false, status: 0, json: null, text: failureMessage(err, secrets) };
  }
}
