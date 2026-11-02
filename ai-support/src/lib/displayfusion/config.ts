import { timingSafeEqualString } from "@/lib/security/timing";
import type { DfScriptDef } from "./types";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/** Windows bridge URL — prefer Tailscale, e.g. http://desktop:17890/run */
export function getDfBridgeUrl(): string | undefined {
  return env("DISPLAYFUSION_BRIDGE_URL") || env("DF_BRIDGE_URL");
}

export function getDfBridgeSecret(): string | undefined {
  return env("DISPLAYFUSION_BRIDGE_SECRET") || env("DF_BRIDGE_SECRET");
}

/**
 * True when the request carries the bridge secret, as a Bearer token or
 * X-VanOS-DF-Secret. That secret may only post run results back; it never
 * authorizes running a command.
 */
export function presentsDfBridgeSecret(req: Request): boolean {
  const secret = getDfBridgeSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    if (timingSafeEqualString(auth.slice(7).trim(), secret)) return true;
  }
  const hdr = req.headers.get("x-vanos-df-secret")?.trim();
  return Boolean(hdr && timingSafeEqualString(hdr, secret));
}

const MAX_DF_ARGS = 8;
const MAX_DF_ARG_LENGTH = 128;
/** No double quotes, backticks, `$` or leading dash: nothing the bridge could read as a flag or split. */
const SAFE_DF_ARG = /^[A-Za-z0-9_][A-Za-z0-9 _.,:@#/+=()'-]*$/;

/**
 * Validate optional DisplayFusion arguments. The Windows bridge passes them
 * to DisplayFusionCommand.exe, so a value like `-functionrun Other` must
 * never reach it.
 */
export function parseDfArgs(
  raw: unknown,
): { ok: true; args?: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (!Array.isArray(raw)) return { ok: false, error: "args must be an array of strings" };
  if (raw.length > MAX_DF_ARGS) return { ok: false, error: `At most ${MAX_DF_ARGS} args` };
  const args: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return { ok: false, error: "args must be an array of strings" };
    const arg = value.trim();
    if (!arg || arg.length > MAX_DF_ARG_LENGTH || !SAFE_DF_ARG.test(arg)) {
      return { ok: false, error: "args may only hold plain words, numbers and simple punctuation" };
    }
    args.push(arg);
  }
  return { ok: true, args: args.length ? args : undefined };
}

export function isDfConfigured(): boolean {
  return Boolean(getDfBridgeUrl() && getDfBridgeSecret());
}

const DEFAULT_SCRIPTS: DfScriptDef[] = [
  {
    id: "focus-coding",
    name: "Focus coding layout",
    command: "LoadWindowLayout",
    description: "Load your coding DisplayFusion layout",
  },
  {
    id: "focus-vanos",
    name: "Mission Control layout",
    command: "LoadWindowLayout",
    description: "Layout with browser + terminal for VanOS",
  },
  {
    id: "next-monitor",
    name: "Move window to next monitor",
    command: "MoveWindowToNextMonitor",
    description: "DisplayFusion Function: next monitor",
  },
  {
    id: "maximize",
    name: "Maximize focused window",
    command: "MaximizeWindow",
  },
];

/**
 * Scripts catalog from env JSON or defaults.
 * DISPLAYFUSION_SCRIPTS_JSON=[{"id":"x","name":"X","command":"MyFunction"}]
 */
export function getDfScripts(): DfScriptDef[] {
  const raw = env("DISPLAYFUSION_SCRIPTS_JSON") || env("DF_SCRIPTS_JSON");
  if (!raw) return DEFAULT_SCRIPTS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_SCRIPTS;
    const list: DfScriptDef[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.command !== "string") continue;
      list.push({
        id: r.id,
        name: typeof r.name === "string" ? r.name : r.id,
        command: r.command,
        description:
          typeof r.description === "string" ? r.description : undefined,
      });
    }
    return list.length ? list : DEFAULT_SCRIPTS;
  } catch {
    return DEFAULT_SCRIPTS;
  }
}

/**
 * DisplayFusion runs only catalog entries from getDfScripts().
 * A script id selects that entry's command. A raw command or function
 * name is accepted only when it equals a catalog id or command.
 */
export function matchDfCommand(input: {
  scriptId?: string;
  command?: string;
  functionName?: string;
}):
  | { ok: true; scriptId: string; command: string }
  | { ok: false; error: string } {
  const scripts = getDfScripts();
  const scriptId = input.scriptId?.trim() || "";
  const raw = input.command?.trim() || input.functionName?.trim() || "";

  if (scriptId) {
    const found = scripts.find((script) => script.id === scriptId);
    if (!found) return { ok: false, error: "Unknown DisplayFusion script" };
    return { ok: true, scriptId: found.id, command: found.command };
  }
  if (!raw) return { ok: false, error: "scriptId or command required" };
  const found = scripts.find((script) => script.command === raw || script.id === raw);
  if (!found) {
    return { ok: false, error: "Command is not in the DisplayFusion allowlist" };
  }
  return { ok: true, scriptId: found.id, command: found.command };
}
