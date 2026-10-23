import { accessClientIp } from "@/lib/security/access-log";
import { durableUpdateJson, isDurableWriteError } from "@/lib/durable/store";
import { storePrefix, upstashCommand, upstashConfigured } from "@/lib/durable/upstash";
import { isDemoMode } from "@/lib/security/config";

type Bucket = { count: number; resetAt: number };

type GlobalBuckets = { __vanosRateLimit?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as GlobalBuckets;
  if (!g.__vanosRateLimit) g.__vanosRateLimit = new Map();
  return g.__vanosRateLimit;
}

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

/**
 * Fixed-window rate limit in this process only. rateLimitConsume uses it
 * when Upstash is not configured or does not answer in time.
 */
export function rateLimitConsumeLocal(
  key: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const map = buckets();
  let b = map.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    map.set(key, b);
  }
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  return { ok: b.count <= limit, remaining, resetAt: b.resetAt };
}

/** Counts one fixed window per key and expires it after the window. */
const INCR_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/** A slow counter should not stall every request behind it. */
const SHARED_TIMEOUT_MS = 1_500;

/**
 * Fixed-window rate limit shared by every instance through Upstash, so a
 * limit means the same thing on Vercel's many instances as on one VPS.
 * Falls back to the per-process counter when Upstash is not configured or
 * fails, so an outage loosens limits rather than blocking everyone.
 */
export async function rateLimitConsume(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  if (!upstashConfigured()) return rateLimitConsumeLocal(key, limit, windowMs);
  return (await upstashConsume(key, limit, windowMs)) ?? rateLimitConsumeLocal(key, limit, windowMs);
}

/** One count in the shared Upstash window, or null when Upstash did not answer. */
async function upstashConsume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const window = Math.floor(Date.now() / windowMs);
  const resetAt = (window + 1) * windowMs;
  try {
    const count = await upstashCommand<number>(
      ["EVAL", INCR_SCRIPT, 1, `${storePrefix()}:rl:${key}:${window}`, windowMs],
      SHARED_TIMEOUT_MS,
    );
    const n = typeof count === "number" ? count : Number(count);
    if (!Number.isFinite(n)) throw new Error("Upstash returned a non-number");
    return { ok: n <= limit, remaining: Math.max(0, limit - n), resetAt };
  } catch {
    return null;
  }
}

/** Local-file counters for rateLimitConsumeDurable, one document for all keys. */
const ATTEMPTS_KEY = "auth-attempts";
/** Enough for every client that could plausibly be mid-lockout; oldest windows go first. */
const MAX_ATTEMPT_BUCKETS = 500;

type AttemptBuckets = Record<string, Bucket>;

function validBucket(value: unknown): value is Bucket {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Bucket>;
  return (
    typeof b.count === "number" &&
    Number.isFinite(b.count) &&
    typeof b.resetAt === "number" &&
    Number.isFinite(b.resetAt)
  );
}

/** One count in the local attempts file, or null when it could not be written. */
async function fileConsume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  // Set from inside `update`, which may run more than once; the last run is
  // the one that was written.
  const out: { result: RateLimitResult | null } = { result: null };
  try {
    await durableUpdateJson<AttemptBuckets>(ATTEMPTS_KEY, (current) => {
      const now = Date.now();
      const kept: Array<[string, Bucket]> = [];
      for (const [k, b] of Object.entries(current && typeof current === "object" ? current : {})) {
        if (k !== key && validBucket(b) && b.resetAt > now) kept.push([k, b]);
      }
      const prior = current?.[key];
      const bucket: Bucket =
        validBucket(prior) && prior.resetAt > now
          ? { count: prior.count + 1, resetAt: prior.resetAt }
          : { count: 1, resetAt: now + windowMs };
      kept.sort((a, b) => b[1].resetAt - a[1].resetAt);
      const next: AttemptBuckets = Object.fromEntries(kept.slice(0, MAX_ATTEMPT_BUCKETS - 1));
      next[key] = bucket;
      out.result = {
        ok: bucket.count <= limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
      };
      return next;
    });
  } catch (e) {
    if (isDurableWriteError(e)) return null;
    throw e;
  }
  return out.result;
}

/**
 * Fixed-window limit that survives a restart: Upstash when configured,
 * otherwise a local JSON file next to the other stores. Used for the TOTP
 * attempt limit, where a restart must not hand out a fresh set of guesses.
 *
 * The per-process counter always counts too, and the stricter of the two
 * wins, so a storage outage never loosens the limit below what this process
 * has seen. Demo mode never writes and uses the process counter alone.
 */
export async function rateLimitConsumeDurable(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const local = rateLimitConsumeLocal(`durable:${key}`, limit, windowMs);
  if (isDemoMode()) return local;
  const shared = upstashConfigured()
    ? await upstashConsume(`durable:${key}`, limit, windowMs)
    : await fileConsume(key, limit, windowMs);
  if (!shared) return local;
  const ok = local.ok && shared.ok;
  const blocking = [local, shared].filter((r) => !r.ok);
  return {
    ok,
    remaining: Math.min(local.remaining, shared.remaining),
    resetAt: blocking.length
      ? Math.max(...blocking.map((r) => r.resetAt))
      : Math.max(local.resetAt, shared.resetAt),
  };
}

/** Same address access logs use. See accessClientIp. */
export function clientIp(req: {
  ip?: string | null;
  headers: { get(name: string): string | null };
}): string {
  return accessClientIp(req);
}

export function clearRateLimits(): void {
  buckets().clear();
}
