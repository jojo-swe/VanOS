"use client";

import { useCallback, useEffect, useState } from "react";
import type { DfSnapshot } from "@/lib/displayfusion/types";
import type { HaEntityState, HaSnapshot } from "@/lib/homeassistant/types";
import { StatusDot } from "./StatusDot";
import { When } from "./When";

/** Domains with a plain on/off switch in the entity list. */
const SWITCHABLE = new Set(["light", "switch", "fan", "input_boolean"]);

type Feedback = { ok: boolean; text: string };

const VERB: Record<string, string> = {
  turn_on: "Turned on",
  turn_off: "Turned off",
  toggle: "Toggled",
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function FeedbackLine({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      className={`mt-1 text-xs ${
        feedback.ok ? "text-[var(--ok-ink)]" : "text-[var(--danger)]"
      }`}
    >
      {feedback.ok ? "✓ " : "✗ "}
      {feedback.text}
    </p>
  );
}

export function AutomationPanel() {
  const [ha, setHa] = useState<HaSnapshot | null>(null);
  const [df, setDf] = useState<DfSnapshot | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const [dfError, setDfError] = useState<string | null>(null);
  const [haDomain, setHaDomain] = useState("light");
  const [haService, setHaService] = useState("toggle");
  const [haEntity, setHaEntity] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});

  const say = useCallback((key: string, value: Feedback) => {
    setFeedback((prev) => ({ ...prev, [key]: value }));
    setTimeout(() => {
      setFeedback((prev) => {
        if (prev[key] !== value) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 8_000);
  }, []);

  const refresh = useCallback(async () => {
    // Home Assistant and the PC load on their own: one being down must not
    // hide the other.
    const [haRes, dfRes] = await Promise.allSettled([
      fetch("/api/homeassistant", { cache: "no-store" }),
      fetch("/api/displayfusion", { cache: "no-store" }),
    ]);
    if (haRes.status === "fulfilled" && haRes.value.ok) {
      const json = await readJson<HaSnapshot>(haRes.value);
      if (json) {
        setHa(json);
        setHaError(null);
      } else {
        setHaError("Home Assistant sent an unreadable answer.");
      }
    } else {
      setHaError(
        haRes.status === "fulfilled"
          ? `Could not load Home Assistant (HTTP ${haRes.value.status}).`
          : "Could not reach Mission Control.",
      );
    }
    if (dfRes.status === "fulfilled" && dfRes.value.ok) {
      const json = await readJson<DfSnapshot>(dfRes.value);
      if (json) {
        setDf(json);
        setDfError(null);
      } else {
        setDfError("DisplayFusion sent an unreadable answer.");
      }
    } else {
      setDfError(
        dfRes.status === "fulfilled"
          ? `Could not load the PC (HTTP ${dfRes.value.status}).`
          : "Could not reach Mission Control.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function callHa(
    key: string,
    call: { domain: string; service: string; entityId?: string },
    okText: string,
  ) {
    setBusy(key);
    try {
      const res = await fetch("/api/homeassistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...call, reportedBy: "dashboard" }),
      });
      const json = await readJson<{
        ok?: boolean;
        call?: { error?: string };
        error?: string;
      }>(res);
      if (!res.ok || !json?.ok) {
        say(key, {
          ok: false,
          text:
            json?.call?.error || json?.error || `Failed (HTTP ${res.status})`,
        });
      } else {
        say(key, { ok: true, text: okText });
      }
      await refresh();
    } catch (e) {
      say(key, {
        ok: false,
        text: e instanceof Error ? e.message : "Home Assistant call failed",
      });
    } finally {
      setBusy(null);
    }
  }

  function switchEntity(e: HaEntityState) {
    const domain = e.domain ?? e.entityId.split(".")[0];
    const name = e.friendlyName || e.entityId;
    if (domain === "scene") {
      void callHa(
        e.entityId,
        { domain, service: "turn_on", entityId: e.entityId },
        `${name} activated`,
      );
      return;
    }
    const on = e.state === "on";
    void callHa(
      e.entityId,
      { domain, service: on ? "turn_off" : "turn_on", entityId: e.entityId },
      `${name} turned ${on ? "off" : "on"}`,
    );
  }

  async function runDf(scriptId: string, name: string) {
    setConfirming(null);
    setBusy(scriptId);
    try {
      const res = await fetch("/api/displayfusion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, reportedBy: "dashboard" }),
      });
      const json = await readJson<{
        ok?: boolean;
        run?: { error?: string; resultSummary?: string };
        error?: string;
      }>(res);
      if (!res.ok || !json?.ok) {
        say(scriptId, {
          ok: false,
          text:
            json?.run?.error || json?.error || `Failed (HTTP ${res.status})`,
        });
      } else {
        say(scriptId, {
          ok: true,
          text: json.run?.resultSummary || `${name} sent to the PC`,
        });
      }
      await refresh();
    } catch (e) {
      say(scriptId, {
        ok: false,
        text: e instanceof Error ? e.message : "Could not reach the PC",
      });
    } finally {
      setBusy(null);
    }
  }

  const entityName = (id?: string) =>
    ha?.entities.find((e) => e.entityId === id)?.friendlyName || id || "";

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Home / PC
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              Lights and switches at home, window layouts on your PC
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:border-[var(--accent)]/40"
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="flex items-center gap-2">
            <StatusDot status={ha?.status ?? "idle"} />
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Home Assistant
            </h3>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {ha
              ? ha.configured
                ? ha.reachable
                  ? `Connected${ha.locationName ? ` · ${ha.locationName}` : ""}`
                  : ha.detail
                : "Not set up yet"
              : haError
                ? ""
                : "Loading…"}
          </p>
          {haError ? (
            <p className="mt-2 text-sm text-[var(--danger)]">{haError}</p>
          ) : null}

          <ul className="mt-3 max-h-72 space-y-1.5 overflow-auto">
            {(ha?.entities ?? []).map((e) => {
              const domain = e.domain ?? e.entityId.split(".")[0];
              const canSwitch =
                SWITCHABLE.has(domain) &&
                (e.state === "on" || e.state === "off");
              const isScene = domain === "scene";
              return (
                <li
                  key={e.entityId}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="min-w-0 truncate font-medium"
                      title={e.entityId}
                    >
                      {e.friendlyName || e.entityId}
                    </span>
                    {canSwitch || isScene ? (
                      <span className="flex shrink-0 items-center gap-2">
                        {canSwitch ? (
                          <span
                            className={`text-xs ${
                              e.state === "on"
                                ? "font-medium text-[var(--ok-ink)]"
                                : "text-[var(--muted-fg)]"
                            }`}
                          >
                            {e.state === "on" ? "On" : "Off"}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy === e.entityId || !ha?.configured}
                          onClick={() => switchEntity(e)}
                          className="rounded-lg border border-[var(--line)] px-3 py-1 text-sm font-medium transition hover:border-[var(--accent)]/40 disabled:opacity-50"
                        >
                          {busy === e.entityId
                            ? "…"
                            : isScene
                              ? "Activate"
                              : e.state === "on"
                                ? "Turn off"
                                : "Turn on"}
                        </button>
                      </span>
                    ) : (
                      <span className="shrink-0 tabular-nums text-[var(--muted-fg)]">
                        {e.state}
                        {e.unit ? ` ${e.unit}` : ""}
                      </span>
                    )}
                  </div>
                  <FeedbackLine feedback={feedback[e.entityId]} />
                </li>
              );
            })}
            {ha && !ha.entities.length ? (
              <li className="text-sm text-[var(--muted-fg)]">
                Nothing to show yet. Pick the devices to watch in Setup.
              </li>
            ) : null}
          </ul>

          <details className="mt-4 rounded-lg border border-[var(--line)]">
            <summary className="cursor-pointer px-3 py-2 text-sm text-[var(--muted-fg)] hover:text-[var(--ink)]">
              Advanced: call a service
            </summary>
            <div className="px-3 pb-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-[var(--muted-fg)]">
                  Domain
                  <input
                    value={haDomain}
                    onChange={(e) => setHaDomain(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
                  />
                </label>
                <label className="text-xs text-[var(--muted-fg)]">
                  Service
                  <input
                    value={haService}
                    onChange={(e) => setHaService(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
                  />
                </label>
                <label className="text-xs text-[var(--muted-fg)] sm:col-span-3">
                  Entity ID
                  <input
                    value={haEntity}
                    onChange={(e) => setHaEntity(e.target.value)}
                    placeholder="light.living_room"
                    className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy === "ha-advanced" || !ha?.configured}
                onClick={() =>
                  void callHa(
                    "ha-advanced",
                    {
                      domain: haDomain.trim(),
                      service: haService.trim(),
                      entityId: haEntity.trim() || undefined,
                    },
                    `Called ${haDomain.trim()}.${haService.trim()}`,
                  )
                }
                className="mt-3 rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
              >
                {busy === "ha-advanced" ? "Calling…" : "Call service"}
              </button>
              <FeedbackLine feedback={feedback["ha-advanced"]} />
              <p className="mt-2 text-xs text-[var(--muted-fg)]">
                Only services on the allowlist run. Locks, alarms and covers are
                off unless you add them.
              </p>
            </div>
          </details>

          {(ha?.recentCalls ?? []).length ? (
            <div className="mt-4">
              <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                Recent
              </h4>
              <ul className="mt-1 space-y-1 text-xs text-[var(--muted-fg)]">
                {(ha?.recentCalls ?? []).slice(0, 5).map((c) => (
                  <li key={c.id}>
                    {c.ok ? "✓" : "✗"}{" "}
                    {VERB[c.service] ?? `${c.domain}.${c.service}`}
                    {c.entityId ? ` ${entityName(c.entityId)}` : ""}
                    {c.error ? ` — ${c.error}` : ""} · <When at={c.at} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="flex items-center gap-2">
            <StatusDot status={df?.status ?? "idle"} />
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              PC layouts (DisplayFusion)
            </h3>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {df
              ? df.configured
                ? "Ready. Each action asks before it runs."
                : "Not set up yet"
              : dfError
                ? ""
                : "Loading…"}
          </p>
          {dfError ? (
            <p className="mt-2 text-sm text-[var(--danger)]">{dfError}</p>
          ) : null}

          <ul className="mt-3 space-y-2">
            {(df?.scripts ?? []).map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-[var(--line)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{s.name}</p>
                    {s.description ? (
                      <p className="text-xs text-[var(--muted-fg)]">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                  {confirming === s.id ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-[var(--muted-fg)]">
                        Run on your PC?
                      </span>
                      <button
                        type="button"
                        onClick={() => void runDf(s.id, s.name)}
                        className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-sm font-semibold text-[var(--bg)]"
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === s.id || !df?.configured}
                      onClick={() => setConfirming(s.id)}
                      className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:border-[var(--accent)]/40 disabled:opacity-50"
                    >
                      {busy === s.id ? "Running…" : "Run…"}
                    </button>
                  )}
                </div>
                <FeedbackLine feedback={feedback[s.id]} />
              </li>
            ))}
          </ul>

          {(df?.recentRuns ?? []).length ? (
            <div className="mt-4">
              <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                Recent
              </h4>
              <ul className="mt-1 space-y-1 text-xs text-[var(--muted-fg)]">
                {(df?.recentRuns ?? []).slice(0, 6).map((r) => (
                  <li key={r.id}>
                    {r.accepted ? "✓" : "✗"}{" "}
                    {df?.scripts.find((s) => s.id === r.scriptId)?.name ??
                      r.command}
                    {r.error ? ` — ${r.error}` : ""}
                    {r.resultSummary ? ` — ${r.resultSummary}` : ""} ·{" "}
                    <When at={r.at} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="mt-4 text-xs text-[var(--muted-fg)]">
            <summary className="cursor-pointer hover:text-[var(--ink)]">
              How this works
            </summary>
            <p className="mt-2">
              A small PowerShell listener on your PC runs the layouts, reached
              over Tailscale. See HOME-LAB.md and{" "}
              <code className="text-[var(--ink)]">bridges/displayfusion/</code>.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
