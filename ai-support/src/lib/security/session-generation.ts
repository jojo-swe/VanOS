import { randomBytes } from "node:crypto";
import { durableReadJson, durableUpdateJson, isDurableWriteError } from "@/lib/durable/store";

/**
 * Session generation: the server-side half of `vanos_session` revocation.
 *
 * Every session cookie carries the generation that was current when it was
 * signed. The proxy accepts a cookie only while its generation is still the
 * stored one. Logout replaces the stored generation with a new random value,
 * which signs out every browser at once ("log out everywhere"). That is the
 * right granularity for a single-owner dashboard and needs no per-session
 * list.
 *
 * The value lives in the durable store (Upstash when configured, else
 * `.data/bots/auth-session-generation.json`). It is random rather than a
 * counter so that a lost or reset document can never make an old cookie valid
 * again: with no document, no cookie is accepted, and the next successful
 * login writes a fresh generation.
 *
 * Reads are cached in this process for FRESH_MS so the proxy does not hit
 * storage on every request. The tradeoff: on a deployment with several
 * instances, a logout on one instance reaches the others within FRESH_MS.
 * On the single VPS the instance that handles the logout updates its own
 * cache at once, so a revoked cookie stops working immediately.
 *
 * Storage outage: the last value read successfully stays in use for up to
 * STALE_LIMIT_MS after that read. Past that, or after a restart with no value
 * read yet, the generation is unknown: no cookie is accepted and none can be
 * issued, so the dashboard falls back to Basic auth (and TOTP when it is on)
 * until storage answers again. A revoked cookie is therefore never accepted
 * for longer than STALE_LIMIT_MS on another instance, and the owner is never
 * locked out for longer than the outage itself.
 */

const KEY = "auth-session-generation";

/** How long a successful read is used without asking storage again. */
export const SESSION_GENERATION_FRESH_MS = 10_000;
/** How long the last good read is still trusted while storage is failing. */
export const SESSION_GENERATION_STALE_LIMIT_MS = 15 * 60_000;
/** After a failed read, wait this long before trying storage again. */
const RETRY_AFTER_FAILURE_MS = 5_000;
/** A slow store should not stall every dashboard request behind it. */
const READ_TIMEOUT_MS = 1_500;

type GenerationDoc = { gen: string; rotatedAt: string };

/** `gen: null` means storage answered and holds no generation yet. */
type CachedGeneration = { gen: string | null; checkedAt: number };

type GlobalState = {
  __vanosSessionGeneration?: {
    cached?: CachedGeneration;
    failedAt?: number;
    inflight?: Promise<boolean>;
  };
};

export type GenerationLookup = { known: true; gen: string | null } | { known: false };

function state(): NonNullable<GlobalState["__vanosSessionGeneration"]> {
  const g = globalThis as unknown as GlobalState;
  if (!g.__vanosSessionGeneration) g.__vanosSessionGeneration = {};
  return g.__vanosSessionGeneration;
}

export function isValidGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

function docGeneration(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const gen = (doc as { gen?: unknown }).gen;
  return isValidGeneration(gen) ? gen : null;
}

function freshDoc(): GenerationDoc {
  return { gen: randomBytes(16).toString("base64url"), rotatedAt: new Date().toISOString() };
}

function remember(gen: string | null): void {
  const s = state();
  s.cached = { gen, checkedAt: Date.now() };
  s.failedAt = undefined;
}

/** One storage read at a time; concurrent callers share it. */
function refresh(): Promise<boolean> {
  const s = state();
  if (s.inflight) return s.inflight;
  const run = (async () => {
    const read = await durableReadJson<GenerationDoc>(KEY, { timeoutMs: READ_TIMEOUT_MS });
    if (!read.ok) {
      state().failedAt = Date.now();
      return false;
    }
    // A document that exists but holds no valid generation counts as none:
    // no cookie matches, and the next login writes a fresh one.
    remember(docGeneration(read.value));
    return true;
  })();
  s.inflight = run;
  return run.finally(() => {
    if (state().inflight === run) state().inflight = undefined;
  });
}

function usable(cached: CachedGeneration | undefined, maxAgeMs: number): cached is CachedGeneration {
  return Boolean(cached && Date.now() - cached.checkedAt < maxAgeMs);
}

/**
 * The current generation, from the cache when it is fresh, else from
 * storage. Falls back to the last good read during an outage, within
 * SESSION_GENERATION_STALE_LIMIT_MS. `{ known: false }` means: accept no
 * cookie and issue none.
 */
export async function currentSessionGeneration(): Promise<GenerationLookup> {
  const s = state();
  if (usable(s.cached, SESSION_GENERATION_FRESH_MS)) return { known: true, gen: s.cached.gen };
  const recentlyFailed =
    s.failedAt !== undefined && Date.now() - s.failedAt < RETRY_AFTER_FAILURE_MS;
  if (!recentlyFailed && (await refresh())) {
    const cached = state().cached;
    if (cached) return { known: true, gen: cached.gen };
  }
  const last = state().cached;
  if (usable(last, SESSION_GENERATION_STALE_LIMIT_MS)) return { known: true, gen: last.gen };
  return { known: false };
}

/**
 * The generation this process last read or wrote, without touching storage.
 * Route handlers run after the proxy, which has just refreshed it, so this is
 * what the proxy itself used. Unknown (never read, or older than the stale
 * limit) accepts no cookie.
 */
export function lastKnownSessionGeneration(): GenerationLookup {
  const cached = state().cached;
  if (usable(cached, SESSION_GENERATION_STALE_LIMIT_MS)) return { known: true, gen: cached.gen };
  return { known: false };
}

/**
 * The generation a new cookie should carry. Writes a fresh one when storage
 * holds none yet. Returns null when storage cannot be read or written: the
 * caller must not issue a cookie then.
 */
export async function ensureSessionGeneration(): Promise<string | null> {
  const lookup = await currentSessionGeneration();
  if (!lookup.known) return null;
  if (lookup.gen) return lookup.gen;
  // Written from inside `update`, which may run more than once; the last
  // run is the one that was stored. Demo mode never runs it at all.
  const out: { gen: string | null } = { gen: null };
  try {
    await durableUpdateJson<GenerationDoc>(KEY, (current) => {
      const existing = docGeneration(current);
      if (existing) {
        out.gen = existing;
        return null;
      }
      const next = freshDoc();
      out.gen = next.gen;
      return next;
    });
  } catch (e) {
    if (isDurableWriteError(e)) {
      state().failedAt = Date.now();
      return null;
    }
    throw e;
  }
  if (!out.gen) return null;
  remember(out.gen);
  return out.gen;
}

/**
 * Sign out every session: store a new generation. Returns false when the
 * new value could not be persisted, in which case nothing was revoked.
 */
export async function revokeAllSessions(): Promise<boolean> {
  const out: { gen: string | null } = { gen: null };
  try {
    await durableUpdateJson<GenerationDoc>(KEY, () => {
      const next = freshDoc();
      out.gen = next.gen;
      return next;
    });
  } catch (e) {
    if (isDurableWriteError(e)) return false;
    throw e;
  }
  if (!out.gen) return false;
  remember(out.gen);
  return true;
}

/** Forget the cached generation, as a restart would. For tests. */
export function clearSessionGenerationCache(): void {
  const s = state();
  s.cached = undefined;
  s.failedAt = undefined;
  s.inflight = undefined;
}
