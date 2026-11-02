import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ObsidianNote } from "./types";

const MAX_FILES = 1_500;
const MAX_DEPTH = 8;
const MAX_READ = 64 * 1024;
const SEARCH_MAX_BYTES = 256 * 1024;

const BLOCKED_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib64",
  "/mnt",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/tmp",
  "/usr",
  "/var",
  "/workspace",
]);

export function noteTitle(relativePath: string, text: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (front) {
    const titleLine = front[1].match(/^title:\s*(.+)$/m);
    if (titleLine) {
      return titleLine[1].trim().replace(/^["']|["']$/g, "").slice(0, 140);
    }
  }
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 140);
  const base = relativePath.split("/").pop() || relativePath;
  return base.replace(/\.md$/i, "");
}

export function noteExcerpt(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const line = body
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#") && !item.startsWith("!"));
  return (line || "").replace(/\s+/g, " ").slice(0, 180);
}

export function searchSnippet(text: string, query: string): string | null {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
  if (!terms.length) return null;
  const haystack = text.toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) return null;
  const front = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = text.slice(front?.[0].length ?? 0);
  const bodyAt = body.toLowerCase().indexOf(terms[0]);
  if (bodyAt >= 0) {
    const start = Math.max(0, bodyAt - 50);
    return body
      .slice(start, bodyAt + terms[0].length + 90)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }
  return noteTitle("note.md", text);
}

export async function resolveVault(input: string): Promise<{ root: string } | { error: string }> {
  if (!path.isAbsolute(input)) {
    return { error: "OBSIDIAN_VAULT_PATH must be an absolute path to the vault folder." };
  }
  let root: string;
  try {
    root = await realpath(input);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { error: "OBSIDIAN_VAULT_PATH does not exist on this host." };
    if (code === "EACCES") return { error: "OBSIDIAN_VAULT_PATH is not readable." };
    return { error: "OBSIDIAN_VAULT_PATH could not be opened." };
  }
  let info;
  try {
    info = await stat(root);
  } catch {
    return { error: "OBSIDIAN_VAULT_PATH could not be opened." };
  }
  if (!info.isDirectory()) return { error: "OBSIDIAN_VAULT_PATH is not a directory." };
  if (BLOCKED_ROOTS.has(root)) {
    return {
      error: "OBSIDIAN_VAULT_PATH must be the vault folder itself, not a system directory.",
    };
  }
  return { root };
}

interface VaultFile {
  relativePath: string;
  fullPath: string;
  mtimeMs: number;
  size: number;
}

function insideRoot(root: string, full: string): boolean {
  const rel = path.relative(root, full);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function collectFiles(root: string): Promise<VaultFile[]> {
  const found: VaultFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (found.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (!insideRoot(root, full)) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      try {
        const info = await stat(full);
        if (!info.isFile()) continue;
        found.push({
          relativePath: path.relative(root, full).split(path.sep).join("/"),
          fullPath: full,
          mtimeMs: info.mtimeMs,
          size: info.size,
        });
      } catch {
        continue;
      }
    }
  }

  await walk(root, 0);
  return found;
}

async function readHead(fullPath: string): Promise<string> {
  const data = await readFile(fullPath);
  return data.subarray(0, MAX_READ).toString("utf8");
}

export async function recentVaultNotes(root: string, limit = 20): Promise<ObsidianNote[]> {
  const files = await collectFiles(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const notes: ObsidianNote[] = [];
  for (const file of files.slice(0, limit)) {
    let text = "";
    try {
      text = await readHead(file.fullPath);
    } catch {
      text = "";
    }
    notes.push({
      path: file.relativePath,
      title: noteTitle(file.relativePath, text),
      updatedAt: new Date(file.mtimeMs).toISOString(),
      excerpt: noteExcerpt(text),
      source: "vault",
    });
  }
  return notes;
}

export async function searchVaultNotes(
  root: string,
  query: string,
  limit = 20,
): Promise<ObsidianNote[]> {
  const files = await collectFiles(root);
  const notes: ObsidianNote[] = [];
  for (const file of files) {
    if (file.size > SEARCH_MAX_BYTES) continue;
    let text = "";
    try {
      text = await readHead(file.fullPath);
    } catch {
      continue;
    }
    const snippet = searchSnippet(text, query);
    const pathHit = file.relativePath.toLowerCase().includes(query.toLowerCase());
    if (!snippet && !pathHit) continue;
    notes.push({
      path: file.relativePath,
      title: noteTitle(file.relativePath, text),
      updatedAt: new Date(file.mtimeMs).toISOString(),
      excerpt: snippet || noteExcerpt(text),
      source: "vault",
    });
  }
  notes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return notes.slice(0, limit);
}
