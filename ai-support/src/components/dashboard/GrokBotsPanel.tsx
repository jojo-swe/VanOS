"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BotBridgeStatusResponse,
  BotEventType,
  BotIngestEvent,
} from "@/lib/bots/types";
import type { HealthStatus } from "@/lib/dashboard/types";
import { StatusDot } from "./StatusDot";
import { When } from "./When";

function isHealth(v: unknown): v is HealthStatus {
  return v === "ok" || v === "warn" || v === "error" || v === "idle";
}

function dotFor(event: BotIngestEvent | undefined, fallback: HealthStatus): HealthStatus {
  if (!event) return fallback;
  if (event.type === "error") return "error";
  if (isHealth(event.status)) return event.status;
  if (event.type === "result" || event.type === "status") return "ok";
  return fallback;
}

function eventWhen(event: BotIngestEvent): string {
  return event.timestamp ?? event.receivedAt;
}

const TYPE_LABEL: Record<string, string> = {
  status: "update",
  result: "done",
  error: "error",
};

function EventTypePill({ type }: { type: BotEventType }) {
  const tone =
    type === "error"
      ? "border-[var(--danger)]/40 text-[var(--danger)]"
      : type === "result"
        ? "border-[var(--ok)]/40 text-[var(--ok-ink)]"
        : "border-[var(--line)] text-[var(--muted-fg)]";
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

function EventBody({ event }: { event: BotIngestEvent }) {
  const headline = event.title ?? event.summary ?? event.focus ?? "Heartbeat";
  const detail =
    event.body && event.body !== headline ? event.body : null;
  const meta = event.metadata
    ? Object.entries(event.metadata)
        .slice(0, 4)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" · ")
    : "";
  return (
    <>
      <p className="mt-1 text-[var(--ink)]/85">{headline}</p>
      {detail ? (
        <p className="mt-1 text-sm text-[var(--muted-fg)]">{detail}</p>
      ) : null}
      {event.links && event.links.length > 0 ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {event.links.map((link) => (
            <a
              key={`${link.label ?? ""}:${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--ink)]"
            >
              {link.label || link.url}
            </a>
          ))}
        </p>
      ) : null}
      {meta ? (
        <details className="mt-1 text-xs text-[var(--muted-fg)]">
          <summary className="cursor-pointer hover:text-[var(--ink)]">Details</summary>
          <p className="mt-1 break-words">{meta}</p>
        </details>
      ) : null}
    </>
  );
}

export function GrokBotsPanel() {
  const [status, setStatus] = useState<BotBridgeStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botId, setBotId] = useState("muddy");
  const [task, setTask] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [confirmSend, setConfirmSend] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as BotBridgeStatusResponse;
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bot status");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!status?.targets.length) return;
    if (!status.targets.some((t) => t.id === botId)) {
      setBotId(status.targets[0].id);
    }
  }, [status, botId]);

  async function dispatch() {
    if (!task.trim()) return;
    setConfirmSend(false);
    setDispatching(true);
    setDispatchMsg(null);
    try {
      const res = await fetch("/api/bots/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, task: task.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        note?: string;
        error?: string;
      };
      const ok = res.ok && data.ok !== false;
      setDispatchMsg({
        ok,
        text: ok
          ? "Sent. The bot is working on it and reports back here when done."
          : (data.error ?? data.note ?? `Not sent (HTTP ${res.status})`),
      });
      if (ok) setTask("");
      await refresh();
    } catch (e) {
      setDispatchMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Could not send the task",
      });
    } finally {
      setDispatching(false);
    }
  }

  async function copyPrompt() {
    if (!status?.setup.routinePrompt) return;
    await navigator.clipboard.writeText(status.setup.routinePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const configured = status?.targets.filter((t) => t.configured) ?? [];
  const loading = !status && !error;
  const botName = status?.targets.find((t) => t.id === botId)?.name ?? botId;

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Grok Bots
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              Send tasks to your bots and see what they report back
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm hover:border-[var(--accent)]/40"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-[var(--danger)]">
            Could not load the bots ({error}). Retrying every 15 seconds.
          </p>
        ) : null}
        {loading ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)]/60"
              />
            ))}
            <span className="sr-only">Loading bots…</span>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(status?.targets ?? []).map((t) => {
            const live = status?.state.latestByBot[t.id];
            return (
              <article
                key={t.id}
                className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-[family-name:var(--font-display)] font-semibold">
                    {t.name}
                  </h3>
                  <span className="flex items-center gap-2">
                    {live?.type ? <EventTypePill type={live.type} /> : null}
                    <StatusDot
                      status={dotFor(
                        live,
                        "idle",
                      )}
                    />
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">{t.role}</p>
                <p
                  className={`mt-2 text-xs ${
                    t.configured ? "text-[var(--ok-ink)]" : "text-[var(--warn-ink)]"
                  }`}
                >
                  {t.configured ? "Can take tasks" : "Can't take tasks yet (see Set up a bot)"}
                </p>
                {live ? (
                  <div className="mt-2 text-sm">
                    <p className="text-[var(--ink)]/85">
                      {live.title ?? live.summary ?? live.focus ?? "Heartbeat"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-fg)]">
                      <When at={eventWhen(live)} />
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted-fg)]">
                    Hasn&apos;t reported yet
                  </p>
                )}
              </article>
            );
          })}
          {Object.values(status?.state.latestByBot ?? {})
            .filter(
              (event) =>
                !(status?.targets ?? []).some((t) => t.id === event.botId),
            )
            .map((event) => (
              <article
                key={event.botId}
                className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-[family-name:var(--font-display)] font-semibold">
                    {event.botName ?? event.botId}
                  </h3>
                  <span className="flex items-center gap-2">
                    {event.type ? <EventTypePill type={event.type} /> : null}
                    <StatusDot status={dotFor(event, "ok")} />
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  Reports in, but can&apos;t take tasks from here
                </p>
                <p className="mt-2 text-sm text-[var(--ink)]/85">
                  {event.title ?? event.summary ?? event.focus ?? "Heartbeat"}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  <When at={eventWhen(event)} />
                </p>
              </article>
            ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Send a task
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            The bot starts right away and reports back here when it is done.
          </p>
          <label className="mt-4 block text-sm">
            <span className="text-[var(--muted-fg)]">Bot</span>
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2"
            >
              {(status?.targets ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.configured ? "" : " (not set up)"}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-[var(--muted-fg)]">Task</span>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder="e.g. Go through today's alerts and report back when done."
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2"
            />
          </label>
          {confirmSend ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm">Send this task to {botName}?</span>
              <button
                type="button"
                onClick={() => void dispatch()}
                className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => setConfirmSend(false)}
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={dispatching || !task.trim() || configured.length === 0}
              onClick={() => {
                setDispatchMsg(null);
                setConfirmSend(true);
              }}
              className="mt-3 rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              {dispatching ? "Sending…" : `Send to ${botName}…`}
            </button>
          )}
          {status && configured.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--warn-ink)]">
              No bot can take tasks yet. See Set up a bot.
            </p>
          ) : null}
          {dispatchMsg ? (
            <p
              role="status"
              className={`mt-2 text-sm ${
                dispatchMsg.ok ? "text-[var(--ok-ink)]" : "text-[var(--danger)]"
              }`}
            >
              {dispatchMsg.ok ? "✓ " : "✗ "}
              {dispatchMsg.text}
            </p>
          ) : null}
        </div>

        <details className="panel self-start">
          <summary className="cursor-pointer font-[family-name:var(--font-display)] font-semibold">
            Set up a bot
          </summary>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">
            {configured.length
              ? `${configured.length} of ${status?.targets.length ?? 0} bots can take tasks.`
              : "No bot can take tasks yet."}{" "}
            {status?.ingestConfigured
              ? "Bots can report back."
              : "Bots can't report back yet (step 3)."}
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--muted-fg)]">
            <li>
              In Grok Bot, create/open a Bot (e.g. Muddy). Ask it to create a
              webhook routine — copy the prompt below.
            </li>
            <li>
              Put the routine&apos;s POST URL + key into{" "}
              <code className="text-[var(--ink)]">GROK_BOT_MUDDY_WEBHOOK_*</code>{" "}
              (or DEFAULT).
            </li>
            <li>
              Set{" "}
              <code className="text-[var(--ink)]">BOTS_INGEST_SECRET</code>{" "}
              here
              {status
                ? status.ingestConfigured
                  ? " — ingest is ready."
                  : " — currently missing."
                : "."}
            </li>
            <li>
              Give the Bot the ingest URL path{" "}
              <code className="text-[var(--ink)]">
                {status?.ingestUrlPath ?? "/api/bots/ingest"}
              </code>{" "}
              and the secret so it can report back.
            </li>
          </ol>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="mt-4 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium hover:border-[var(--accent)]/40"
          >
            {copied ? "Copied routine prompt" : "Copy routine prompt"}
          </button>
          {status?.setup.routinePrompt ? (
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 p-3 text-xs whitespace-pre-wrap">
              {status.setup.routinePrompt}
            </pre>
          ) : null}
        </details>
      </div>

      <div className="panel">
        <h3 className="font-[family-name:var(--font-display)] font-semibold">
          Latest event per bot
        </h3>
        <ul className="mt-3 space-y-2">
          {Object.values(status?.state.latestByBot ?? {})
            .sort((a, b) => eventWhen(b).localeCompare(eventWhen(a)))
            .map((event) => (
              <li
                key={event.botId}
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {event.botName ?? event.botId}
                  </span>
                  <span className="flex items-center gap-2">
                    {event.type ? <EventTypePill type={event.type} /> : null}
                    <StatusDot status={dotFor(event, "ok")} />
                  </span>
                </div>
                <EventBody event={event} />
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  <When at={eventWhen(event)} />
                </p>
              </li>
            ))}
          {Object.keys(status?.state.latestByBot ?? {}).length === 0 ? (
            <li className="text-sm text-[var(--muted-fg)]">
              {loading ? "Loading…" : "No reports yet"}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Tasks sent
          </h3>
          <ul className="mt-3 space-y-2">
            {(status?.state.dispatches ?? []).slice(0, 8).map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.botName}</span>
                  <StatusDot status={d.accepted ? "ok" : "error"} />
                </div>
                <p className="mt-1 text-[var(--muted-fg)]">{d.task}</p>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  <When at={d.createdAt} />
                  {d.accepted ? " · started" : " · not accepted"}
                  {d.error ? ` · ${d.error}` : ""}
                </p>
              </li>
            ))}
            {(status?.state.dispatches.length ?? 0) === 0 ? (
              <li className="text-sm text-[var(--muted-fg)]">
                {loading ? "Loading…" : "None yet"}
              </li>
            ) : null}
          </ul>
        </div>
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Recent reports
          </h3>
          <ul className="mt-3 space-y-2">
            {(status?.state.events ?? []).slice(0, 8).map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.botName ?? e.botId}</span>
                  <span className="flex items-center gap-2">
                    {e.type ? <EventTypePill type={e.type} /> : null}
                    <StatusDot status={dotFor(e, "ok")} />
                  </span>
                </div>
                <EventBody event={e} />
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  <When at={eventWhen(e)} />
                </p>
              </li>
            ))}
            {(status?.state.events.length ?? 0) === 0 ? (
              <li className="text-sm text-[var(--muted-fg)]">
                {loading ? "Loading…" : "None yet"}
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
