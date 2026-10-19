import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

/**
 * Filesystem calls the durable store makes. A plain object so tests can
 * replace one method; Node's own `fs` exports cannot be redefined.
 */
export const fsOps = {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
};

/**
 * Errnos that mean the bytes were not stored. Anything else with a write
 * syscall and an `E*` code is treated the same way: log it, keep reading.
 */
const FS_WRITE_CODES = new Set([
  "ENOSPC",
  "EDQUOT",
  "EROFS",
  "EACCES",
  "EPERM",
  "EIO",
  "EBUSY",
  "ETXTBSY",
  "EFBIG",
  "ENAMETOOLONG",
  "ELOOP",
  "ENOTDIR",
  "EISDIR",
  "EMFILE",
  "ENFILE",
  "ENXIO",
  "ENODEV",
  "ENOMEM",
  "ENOSYS",
  "EXDEV",
  "ENOENT",
  "EEXIST",
  "EREMOTEIO",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EBADF",
  "EAGAIN",
  "EWOULDBLOCK",
]);

const WRITE_SYSCALLS = new Set([
  "write",
  "open",
  "rename",
  "mkdir",
  "unlink",
  "rmdir",
  "chmod",
  "fchmod",
  "fsync",
  "ftruncate",
  "truncate",
  "link",
  "symlink",
  "copyfile",
]);

type ErrnoLike = { code?: unknown; syscall?: unknown; cause?: unknown };

function isErrno(code: string): boolean {
  return /^E[A-Z0-9]+$/.test(code);
}

/** Errno of a filesystem write failure, walking `cause`. Null for anything else. */
export function fsWriteCode(err: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, syscall } = current as ErrnoLike;
    if (typeof code === "string" && isErrno(code)) {
      if (FS_WRITE_CODES.has(code)) return code;
      if (typeof syscall === "string" && WRITE_SYSCALLS.has(syscall)) return code;
    }
    current = (current as ErrnoLike).cause;
  }
  return null;
}

/** Codes already written to the log in this process. One line per code. */
const loggedCodes = new Set<string>();
/** Latest write failure still in effect. Cleared by a successful write. */
let activeFailure: string | null = null;

export function currentFsWriteFailure(): string | null {
  return activeFailure;
}

export function clearFsWriteFailure(): void {
  activeFailure = null;
}

/** Forget the log dedupe and the active failure. Tests only. */
export function resetFsWriteState(): void {
  loggedCodes.clear();
  activeFailure = null;
}

/**
 * Remember a filesystem write failure and log its code once.
 * The line is only `code` plus a fixed event name: no path, no message,
 * no file contents, no secrets.
 * Returns the code, or null when `err` is not a filesystem write error.
 */
export function noteFsWriteError(err: unknown): string | null {
  const code = fsWriteCode(err);
  if (!code) return null;
  activeFailure = code;
  if (loggedCodes.has(code)) return code;
  loggedCodes.add(code);
  try {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "fs_write_failed",
        code,
      }),
    );
  } catch {
    /* stderr can fail when the disk is full; the request still has to answer */
  }
  return code;
}
