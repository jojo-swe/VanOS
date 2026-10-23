import path from "node:path";
import { isDemoMode } from "@/lib/security/config";
import { clearFsWriteFailure, fsOps, fsWriteCode, noteFsWriteError } from "./fs";
import { storePrefix, upstashCommand, upstashConfigured } from "./upstash";

export type DurableBackend = "memory+file" | "upstash";

type GlobalCache = {
  __vanosDurableCache?: Map<string, string>;
};

function cache(): Map<string, string> {
  const g = globalThis as unknown as GlobalCache;
  if (!g.__vanosDurableCache) g.__vanosDurableCache = new Map();
  return g.__vanosDurableCache;
}

function dataDir() {
  return (
    process.env.BOTS_DATA_DIR?.trim() ||
    process.env.VANOS_DATA_DIR?.trim() ||
    path.join(process.cwd(), ".data", "bots")
  );
}

function filePath(key: string) {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dataDir(), `${safe}.json`);
}

export function getDurableBackend(): DurableBackend {
  return upstashConfigured() ? "upstash" : "memory+file";
}

/**
 * A write that reached no durable backend. Routes turn this into a 503 so a
 * caller never sees `ok: true` for data that only lives in one instance's
 * memory.
 */
export class DurableWriteError extends Error {
  /** Errno when the failure was a filesystem write. Absent for Upstash. */
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DurableWriteError";
    if (options?.code) this.code = options.code;
  }
}

export function isDurableWriteError(e: unknown): e is DurableWriteError {
  return e instanceof DurableWriteError;
}

function namespaced(key: string) {
  return `${storePrefix()}:${key}`;
}

/** Read JSON document by key. Returns null if missing. */
export async function durableGetJson<T>(key: string): Promise<T | null> {
  if (isDemoMode()) return null;
  const ns = namespaced(key);

  if (upstashConfigured()) {
    try {
      const raw = await upstashCommand<string | null>(["GET", ns]);
      if (raw == null || raw === "") return null;
      const parsed = JSON.parse(raw) as T;
      cache().set(ns, raw);
      return parsed;
    } catch {
      // fall through to local cache/file
    }
  }

  return readLocal<T>(key, ns);
}

export type DurableRead<T> = { ok: true; value: T | null } | { ok: false };

/**
 * Read a JSON document and say whether the answer can be trusted.
 *
 * `durableGetJson` treats an unreachable or unreadable store as "missing",
 * which is fine for panels but not for security state: a revocation marker
 * that reads as missing would let revoked sessions back in. This returns
 * `{ ok: false }` instead when Upstash fails or times out, or when the local
 * file exists but cannot be read or parsed. `{ ok: true, value: null }`
 * means the document really does not exist. No fallback from Upstash to the
 * local file: the caller decides what an outage means.
 */
export async function durableReadJson<T>(
  key: string,
  opts?: { timeoutMs?: number },
): Promise<DurableRead<T>> {
  if (isDemoMode()) return { ok: true, value: null };
  const ns = namespaced(key);

  if (upstashConfigured()) {
    try {
      const raw = await upstashCommand<string | null>(["GET", ns], opts?.timeoutMs);
      if (raw == null || raw === "") return { ok: true, value: null };
      const parsed = JSON.parse(raw) as T;
      cache().set(ns, raw);
      return { ok: true, value: parsed };
    } catch {
      return { ok: false };
    }
  }

  const hit = cache().get(ns);
  if (hit) {
    try {
      return { ok: true, value: JSON.parse(hit) as T };
    } catch {
      /* fall through to the file */
    }
  }
  let raw: string;
  try {
    raw = await fsOps.readFile(filePath(key), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return { ok: true, value: null };
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(raw) as T;
    cache().set(ns, raw);
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

/**
 * Forget every cached document in this process, as a restart would. The
 * files and Upstash keep their data. Tests use it to simulate a restart.
 */
export function clearDurableCache(): void {
  cache().clear();
}

/**
 * KEYS[1] holds the document, KEYS[2] a write counter. Set KEYS[1] to
 * ARGV[2] and bump the counter only if the counter still equals ARGV[1].
 * Returns 1 on write, 0 when someone else wrote first.
 */
const CAS_SCRIPT = `
local ver = redis.call('GET', KEYS[2]) or '0'
if ver ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('INCR', KEYS[2])
return 1
`;

const CAS_ATTEMPTS = 8;

const PERSIST_FAILED =
  "Could not persist data: no Upstash configured and the data directory is not writable. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.";

/** Unique temp names inside this process. No Node crypto: the store is also imported by the edge proxy. */
let tempSeq = 0;

/** Drop a temp file. A missing temp is fine: the write may have failed before creating it. */
async function discardTemp(tmp: string): Promise<void> {
  try {
    await fsOps.rm(tmp, { force: true });
  } catch (err) {
    if (fsWriteCode(err) === "ENOENT") return;
    noteFsWriteError(err);
  }
}

/**
 * Write `raw` without truncating the previous file. The new bytes go to a
 * temp file and replace the destination only after that write succeeds, so
 * a full disk leaves the last good document readable.
 */
async function writeLocalFile(key: string, raw: string): Promise<void> {
  const dest = filePath(key);
  tempSeq = (tempSeq + 1) % 1_000_000;
  const tmp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.${Date.now().toString(36)}.${tempSeq.toString(36)}.tmp`,
  );
  try {
    await fsOps.mkdir(dataDir(), { recursive: true });
    await fsOps.writeFile(tmp, raw, "utf8");
    await fsOps.rename(tmp, dest);
    clearFsWriteFailure();
  } catch (e) {
    await discardTemp(tmp);
    const code = noteFsWriteError(e) ?? undefined;
    throw new DurableWriteError(PERSIST_FAILED, { cause: e, code });
  }
}

type LockGlobal = { __vanosDurableLocks?: Map<string, Promise<unknown>> };

/** Serialize local read-modify-write per key inside this process. */
async function withLocalLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const g = globalThis as unknown as LockGlobal;
  if (!g.__vanosDurableLocks) g.__vanosDurableLocks = new Map();
  const locks = g.__vanosDurableLocks;
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Write JSON document by key. Throws DurableWriteError when nothing persisted. */
export async function durableSetJson(key: string, value: unknown): Promise<void> {
  await durableUpdateJson<unknown>(key, () => value);
}

/**
 * Atomically read, change and write one JSON document.
 *
 * `update` gets the current value (null when missing) and returns the next
 * value, or null to leave the document untouched. With Upstash, a write
 * only lands if nobody changed the document since it was read; otherwise
 * `update` runs again on the fresh value, so it must not have side effects
 * beyond building its return value. Locally, updates to one key run one at
 * a time.
 *
 * Throws DurableWriteError when the change could not be persisted.
 */
export async function durableUpdateJson<T>(
  key: string,
  update: (current: T | null) => T | null,
): Promise<T | null> {
  if (isDemoMode()) return null;
  const ns = namespaced(key);

  if (upstashConfigured()) {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      let currentRaw: string | null;
      let version: string;
      try {
        const pair = await upstashCommand<(string | null)[]>(["MGET", ns, `${ns}:ver`]);
        currentRaw = pair?.[0] ?? null;
        version = pair?.[1] ?? "0";
      } catch (e) {
        throw new DurableWriteError("Upstash read failed", { cause: e });
      }
      let current: T | null = null;
      if (currentRaw) {
        try {
          current = JSON.parse(currentRaw) as T;
        } catch {
          current = null;
        }
      }
      const next = update(current);
      if (next === null) return current;
      const nextRaw = JSON.stringify(next, null, 2);
      let written: number | null;
      try {
        written = await upstashCommand<number>([
          "EVAL",
          CAS_SCRIPT,
          2,
          ns,
          `${ns}:ver`,
          version,
          nextRaw,
        ]);
      } catch (e) {
        throw new DurableWriteError("Upstash write failed", { cause: e });
      }
      if (written === 1) {
        cache().set(ns, nextRaw);
        return next;
      }
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (attempt + 1)));
    }
    throw new DurableWriteError(`Too many concurrent writes to ${key}; try again`);
  }

  return withLocalLock(ns, async () => {
    const next = update(await readLocal<T>(key, ns));
    if (next === null) return null;
    const raw = JSON.stringify(next, null, 2);
    await writeLocalFile(key, raw);
    cache().set(ns, raw);
    return next;
  });
}

async function readLocal<T>(key: string, ns: string): Promise<T | null> {
  const hit = cache().get(ns);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* continue */
    }
  }
  try {
    const raw = await fsOps.readFile(filePath(key), "utf8");
    cache().set(ns, raw);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function durablePing(): Promise<{
  backend: DurableBackend;
  ok: boolean;
  detail: string;
}> {
  if (isDemoMode()) {
    return {
      backend: "memory+file",
      ok: true,
      detail: "Demo mode uses sample data only",
    };
  }
  const backend = getDurableBackend();
  if (backend === "upstash") {
    try {
      const pong = await upstashCommand<string>(["PING"]);
      return {
        backend,
        ok: pong === "PONG" || pong != null,
        detail: `Upstash PING → ${String(pong)}`,
      };
    } catch (e) {
      return {
        backend,
        ok: false,
        detail: e instanceof Error ? e.message : "Upstash failed",
      };
    }
  }
  try {
    await fsOps.mkdir(dataDir(), { recursive: true });
    return {
      backend,
      ok: true,
      detail: `Local dir ${dataDir()}`,
    };
  } catch (e) {
    const code = noteFsWriteError(e);
    return {
      backend,
      ok: false,
      detail: code ?? "Local FS unavailable",
    };
  }
}
