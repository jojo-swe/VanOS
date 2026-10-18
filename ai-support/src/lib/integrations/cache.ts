import { createHash } from "node:crypto";

interface Slot<T> {
  at: number;
  ttl: number;
  value: T;
}

const slots = new Map<string, Slot<unknown>>();

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function readCache<T>(key: string, now = Date.now()): T | undefined {
  const slot = slots.get(key) as Slot<T> | undefined;
  if (!slot) return undefined;
  if (now - slot.at > slot.ttl) {
    slots.delete(key);
    return undefined;
  }
  return slot.value;
}

export function writeCache<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  slots.set(key, { at: now, ttl: ttlMs, value });
}

export function clearIntegrationCache(prefix?: string): void {
  if (!prefix) {
    slots.clear();
    return;
  }
  for (const key of slots.keys()) {
    if (key.startsWith(prefix)) slots.delete(key);
  }
}

export const CACHE_OK_MS = 60_000;
export const CACHE_ERROR_MS = 15_000;
