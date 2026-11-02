import { NextResponse } from "next/server";
import { currentFsWriteFailure, noteFsWriteError } from "@/lib/durable/fs";
import type { DashboardData } from "./types";

/** Last payload that loaded. Served again when a later load throws. */
let remembered: DashboardData | undefined;

/** Forget the in-memory snapshot. Tests only. */
export function resetDashboardMemory(): void {
  remembered = undefined;
}

/**
 * Run a dashboard load. A filesystem write error never becomes a 500:
 * the fresh read is returned with `degraded: true` when it succeeded,
 * otherwise the last good payload, otherwise 503.
 */
export async function serveDashboard(
  load: () => Promise<DashboardData>,
): Promise<Response> {
  try {
    const data = await load();
    remembered = data;
    const reason = currentFsWriteFailure();
    if (!reason) return NextResponse.json(data);
    return NextResponse.json({ ...data, degraded: true, reason });
  } catch (err) {
    const reason = noteFsWriteError(err);
    if (!reason) throw err;
    if (remembered) {
      return NextResponse.json({ ...remembered, degraded: true, reason });
    }
    return NextResponse.json(
      { status: "degraded", reason },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}
