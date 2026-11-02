import http from "node:http";
import https from "node:https";
import { scrubSecrets, timedFetch, type TimedResponse } from "@/lib/integrations/http";
import { obsidianInsecureTls } from "./config";
import { noteTitle } from "./vault";
import type { ObsidianNote } from "./types";

const TIMEOUT_MS = 8_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function insecureRequest(
  url: string,
  key: string,
  method: string,
  timeoutMs: number,
): Promise<TimedResponse> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, json: null, text: "Invalid URL" });
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json,
            text: scrubSecrets(text, [key]),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: null, text: "Timed out waiting for Obsidian" });
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        status: 0,
        json: null,
        text: scrubSecrets(err.message, [key]) || "Obsidian API unreachable",
      });
    });
    req.end();
  });
}

export async function obsidianRequest(
  base: string,
  key: string,
  host: string,
  pathAndQuery: string,
  fetchImpl: typeof fetch,
  method = "GET",
): Promise<TimedResponse> {
  const url = `${base}${pathAndQuery}`;
  if (obsidianInsecureTls()) return insecureRequest(url, key, method, TIMEOUT_MS);
  return timedFetch(
    url,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      timeoutMs: TIMEOUT_MS,
      secrets: [key],
      allowHosts: [host],
    },
    fetchImpl,
  );
}

function listNames(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json.filter((item): item is string => typeof item === "string");
  }
  const rec = asRecord(json);
  if (!rec || !Array.isArray(rec.files)) return [];
  return rec.files.filter((item): item is string => typeof item === "string");
}

export async function listRecentFromApi(
  base: string,
  key: string,
  host: string,
  fetchImpl: typeof fetch,
): Promise<{ notes: ObsidianNote[]; error?: string }> {
  const notes: ObsidianNote[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: "", depth: 0 }];
  let dirs = 0;
  while (queue.length && notes.length < 30 && dirs < 40) {
    const current = queue.shift();
    if (!current) break;
    dirs += 1;
    const path = current.dir
      ? `/vault/${current.dir.split("/").filter(Boolean).map(encodeURIComponent).join("/")}/`
      : "/vault/";
    const res = await obsidianRequest(base, key, host, path, fetchImpl);
    if (!res.ok) {
      if (!notes.length) {
        return {
          notes: [],
          error:
            res.status === 401
              ? "Obsidian rejected OBSIDIAN_API_KEY (401)."
              : `Obsidian API failed (${res.status || "network"}). ${res.text || "Unreachable."}`,
        };
      }
      break;
    }
    for (const name of listNames(res.json)) {
      if (name.endsWith("/")) {
        if (current.depth < 3 && !name.startsWith(".")) {
          const next = `${current.dir}${name}`;
          queue.push({ dir: next, depth: current.depth + 1 });
        }
        continue;
      }
      if (!name.toLowerCase().endsWith(".md")) continue;
      const relative = `${current.dir}${name}`.replace(/^\/+/, "");
      notes.push({
        path: relative,
        title: noteTitle(relative, ""),
        excerpt: "",
        source: "api",
      });
      if (notes.length >= 30) break;
    }
  }
  return { notes };
}

export function parseApiSearch(json: unknown): ObsidianNote[] {
  if (!Array.isArray(json)) return [];
  const notes: ObsidianNote[] = [];
  for (const row of json) {
    const rec = asRecord(row);
    if (!rec) continue;
    const filename = typeof rec.filename === "string" ? rec.filename : "";
    if (!filename) continue;
    const matches = Array.isArray(rec.matches) ? rec.matches : [];
    const excerpt = matches
      .map((match) => {
        const item = asRecord(match);
        return typeof item?.context === "string" ? item.context : "";
      })
      .filter(Boolean)
      .join(" … ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    notes.push({
      path: filename,
      title: noteTitle(filename, ""),
      excerpt,
      source: "api",
    });
    if (notes.length >= 20) break;
  }
  return notes;
}

export async function searchApi(
  base: string,
  key: string,
  host: string,
  query: string,
  fetchImpl: typeof fetch,
): Promise<{ notes: ObsidianNote[]; error?: string }> {
  const params = new URLSearchParams({ query, contextLength: "100" });
  const res = await obsidianRequest(
    base,
    key,
    host,
    `/search/simple/?${params.toString()}`,
    fetchImpl,
    "POST",
  );
  if (!res.ok) {
    return {
      notes: [],
      error:
        res.status === 401
          ? "Obsidian rejected OBSIDIAN_API_KEY (401)."
          : `Obsidian search failed (${res.status || "network"}). ${res.text || "Unreachable."}`,
    };
  }
  return { notes: parseApiSearch(res.json) };
}
