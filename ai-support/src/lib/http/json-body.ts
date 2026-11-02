import { NextResponse } from "next/server";

/** Default cap for agent and dashboard write bodies. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: NextResponse };

function fail(status: number, error: string, extra?: Record<string, unknown>): BodyResult {
  return { ok: false, response: NextResponse.json({ error, ...extra }, { status }) };
}

/**
 * Read a JSON object body, refusing anything over `maxBytes` before it is
 * parsed. A declared Content-Length over the cap is refused without reading.
 * The result has a null prototype, so `__proto__` keys are plain data.
 */
export async function readJsonObject(
  req: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<BodyResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isInteger(n) || n < 0) return fail(400, "Invalid Content-Length");
    if (n > maxBytes) return fail(413, `Payload too large (max ${maxBytes} bytes)`, { maxBytes });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return fail(400, "Invalid body");
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return fail(413, `Payload too large (max ${maxBytes} bytes)`, { maxBytes });
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    return fail(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "Expected a JSON object");
  }

  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(body)) out[key] = (body as Record<string, unknown>)[key];
  return { ok: true, value: out };
}
