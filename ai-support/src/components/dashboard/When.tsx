"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime, formatRelative } from "@/lib/format/time";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => listeners.forEach((l) => l()), TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Stable within a 30s window, so React sees the same snapshot between ticks. */
function getSnapshot() {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

function getServerSnapshot() {
  return 0;
}

/**
 * The current time, updated every 30s. `null` during server render and
 * hydration, so nothing time-dependent mismatches between server and browser.
 */
export function useNow(): number | null {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return now || null;
}

/** "5 min ago", with the full local date on hover. Empty until mounted. */
export function When({
  at,
  absolute = false,
  className,
}: {
  at: string | number | undefined | null;
  absolute?: boolean;
  className?: string;
}) {
  const now = useNow();
  if (!at || now === null) return null;
  const full = formatDateTime(at);
  if (!full) return null;
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={full}
      className={className}
    >
      {absolute ? full : formatRelative(at, now)}
    </time>
  );
}
