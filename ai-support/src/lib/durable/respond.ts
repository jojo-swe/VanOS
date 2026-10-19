import { NextResponse } from "next/server";
import { noteFsWriteError } from "./fs";
import { isDurableWriteError } from "./store";

/**
 * Answer 503 when a route's write reached no durable backend, instead of a
 * 500 or, worse, `ok: true` for data that was never saved.
 */
export function withDurableErrors<A extends unknown[]>(
  handler: (req: Request, ...args: A) => Promise<Response> | Response,
): (req: Request, ...args: A) => Promise<Response> {
  return async (req: Request, ...args: A) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      const fsCode = noteFsWriteError(err);
      if (!isDurableWriteError(err) && !fsCode) throw err;
      // Filesystem codes are logged once, with the code only. Other durable
      // failures (Upstash) still log the safe message we wrote ourselves.
      if (!fsCode && isDurableWriteError(err)) {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            event: "durable_write_failed",
            path: new URL(req.url).pathname,
            detail: err.message,
          }),
        );
      }
      return NextResponse.json(
        { error: "Storage is unavailable, so nothing was saved. Try again shortly." },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
  };
}

/**
 * Run a write whose failure must not hide what already happened, such as
 * logging a Home Assistant call that has already run. Logs and returns
 * false instead of throwing.
 */
export async function bestEffortWrite(label: string, write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    const fsCode = noteFsWriteError(err);
    if (!isDurableWriteError(err) && !fsCode) throw err;
    if (!fsCode && isDurableWriteError(err)) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "durable_write_failed",
          label,
          detail: err.message,
        }),
      );
    }
    return false;
  }
}
