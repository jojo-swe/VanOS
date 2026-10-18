import { sampleDfSnapshot } from "@/lib/demo/sample";
import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { bestEffortWrite } from "@/lib/durable/respond";
import { isDemoMode } from "@/lib/security/config";
import {
  getDfBridgeSecret,
  getDfBridgeUrl,
  getDfScripts,
  isDfConfigured,
  matchDfCommand,
  parseDfArgs,
} from "./config";
import type { DfRunRecord, DfRunRequest, DfSnapshot } from "./types";

const KEY = "df-state";
const MAX_RUNS = 50;

interface DfStore {
  updatedAt: string;
  recentRuns: DfRunRecord[];
}

function empty(): DfStore {
  return { updatedAt: new Date().toISOString(), recentRuns: [] };
}

async function load(): Promise<DfStore> {
  return normalize(await durableGetJson<DfStore>(KEY));
}

function normalize(disk: DfStore | null): DfStore {
  if (!disk || !Array.isArray(disk.recentRuns)) return empty();
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    recentRuns: disk.recentRuns ?? [],
  };
}

function newId() {
  return `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function getDfSnapshot(): Promise<DfSnapshot> {
  if (isDemoMode()) return sampleDfSnapshot();
  const store = await load();
  const configured = isDfConfigured();
  return {
    updatedAt: store.updatedAt,
    configured,
    bridgeUrl: getDfBridgeUrl(),
    scripts: getDfScripts(),
    recentRuns: store.recentRuns,
    status: configured ? "ok" : "idle",
    detail: configured
      ? `Bridge ${getDfBridgeUrl()} · ${getDfScripts().length} scripts`
      : "Set DISPLAYFUSION_BRIDGE_URL + DISPLAYFUSION_BRIDGE_SECRET (Windows bridge on Tailscale)",
  };
}

export async function recordDfRun(
  partial: Omit<DfRunRecord, "id" | "at"> & { id?: string; at?: string },
): Promise<DfRunRecord> {
  const row: DfRunRecord = {
    id: partial.id ?? newId(),
    at: partial.at ?? new Date().toISOString(),
    scriptId: partial.scriptId,
    command: partial.command,
    args: partial.args,
    accepted: partial.accepted,
    bridgeStatus: partial.bridgeStatus,
    error: partial.error,
    reportedBy: partial.reportedBy,
    resultSummary: partial.resultSummary,
  };
  // The call already happened; failing to log it must not hide the result.
  await bestEffortWrite("df_run_log", () =>
    durableUpdateJson<DfStore>(KEY, (disk) => {
      const state = normalize(disk);
      state.recentRuns = [row, ...state.recentRuns].slice(0, MAX_RUNS);
      state.updatedAt = new Date().toISOString();
      return state;
    }),
  );
  return row;
}

export async function dispatchDfRun(
  req: DfRunRequest,
): Promise<{ run: DfRunRecord; snapshot: DfSnapshot }> {
  if (isDemoMode()) {
    return {
      snapshot: await getDfSnapshot(),
      run: {
        id: "demo",
        at: new Date().toISOString(),
        scriptId: req.scriptId,
        command: req.command ?? "",
        accepted: false,
        error: "Demo mode is read-only",
        reportedBy: req.reportedBy,
      },
    };
  }
  const matched = matchDfCommand(req);
  if (!matched.ok) {
    const run = await recordDfRun({
      scriptId: req.scriptId,
      command: "",
      accepted: false,
      error: matched.error,
      reportedBy: req.reportedBy,
    });
    return { run, snapshot: await getDfSnapshot() };
  }

  const { scriptId, command } = matched;
  const parsedArgs = parseDfArgs(req.args);
  if (!parsedArgs.ok) {
    const run = await recordDfRun({
      scriptId,
      command,
      accepted: false,
      error: parsedArgs.error,
      reportedBy: req.reportedBy,
    });
    return { run, snapshot: await getDfSnapshot() };
  }
  const args = parsedArgs.args;

  const url = getDfBridgeUrl();
  const secret = getDfBridgeSecret();
  if (!url || !secret) {
    const run = await recordDfRun({
      scriptId,
      command,
      args,
      accepted: false,
      error: "DisplayFusion bridge not configured",
      reportedBy: req.reportedBy,
    });
    return { run, snapshot: await getDfSnapshot() };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "X-VanOS-DF-Secret": secret,
      },
      body: JSON.stringify({
        scriptId,
        command,
        functionName: req.functionName || command,
        args: args ?? [],
        reportedBy: req.reportedBy ?? "vanos",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    let resultSummary: string | undefined;
    let error: string | undefined;
    try {
      const json = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        error?: string;
        output?: string;
      };
      resultSummary = json.summary || json.output;
      if (!res.ok || json.ok === false) {
        error = json.error || `Bridge HTTP ${res.status}`;
      }
    } catch {
      if (!res.ok) error = `Bridge HTTP ${res.status}`;
      else resultSummary = await res.text().catch(() => undefined);
    }

    const run = await recordDfRun({
      scriptId,
      command,
      args,
      accepted: res.ok && !error,
      bridgeStatus: res.status,
      error,
      resultSummary,
      reportedBy: req.reportedBy,
    });
    return { run, snapshot: await getDfSnapshot() };
  } catch (e) {
    const run = await recordDfRun({
      scriptId,
      command,
      args,
      accepted: false,
      error: e instanceof Error ? e.message : "Bridge request failed",
      reportedBy: req.reportedBy,
    });
    return { run, snapshot: await getDfSnapshot() };
  }
}

/** Bridge callback after local execution */
export async function ingestDfResult(payload: {
  runId?: string;
  command?: string;
  ok: boolean;
  summary?: string;
  error?: string;
  reportedBy?: string;
}): Promise<DfRunRecord> {
  return recordDfRun({
    id: payload.runId,
    command: payload.command || "callback",
    accepted: payload.ok,
    resultSummary: payload.summary,
    error: payload.error,
    reportedBy: payload.reportedBy ?? "displayfusion-bridge",
  });
}
