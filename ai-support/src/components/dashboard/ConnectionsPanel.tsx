"use client";

import { useCallback, useEffect, useState } from "react";
import { connectionHealth } from "@/lib/connections/compute";
import type { ConnectionsSnapshot, WireStatus } from "@/lib/connections/types";
import { StatusDot } from "./StatusDot";
import { When } from "./When";

type Tab = "status" | "mail" | "github" | "notes" | "files";

type ConnectionsResponse = ConnectionsSnapshot & {
  ingest: { path: string; auth: string };
};

const TABS: { id: Tab; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "mail", label: "Mail" },
  { id: "github", label: "GitHub" },
  { id: "notes", label: "Notion / Joplin" },
  { id: "files", label: "Drive" },
];

const WIRE_LABEL: Record<WireStatus, string> = {
  live: "Live",
  "mcp-ready": "Agents can read",
  "ingest-only": "Agents push data",
  missing: "Missing",
  error: "Error",
};

export function ConnectionsPanel() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("status");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setData((await res.json()) as ConnectionsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load connections");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const live = data?.connections.filter((c) => c.wire === "live").length ?? 0;
  const ready =
    data?.connections.filter(
      (c) => c.wire === "mcp-ready" || c.wire === "ingest-only",
    ).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Connections
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              Mail · GitHub · Notion · Joplin · Drive · HA / DisplayFusion
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
          <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Live" value={String(live)} note="Agents send fresh data" />
          <Stat
            label="Partly connected"
            value={String(ready)}
            note="Agents can read it, but it is not fully wired up"
          />
          <Stat
            label="Unread mail"
            value={data ? String(data.mail.unread) : "—"}
            note={
              data ? `${data.mail.important} important` : undefined
            }
          />
          <Stat
            label="Open PRs"
            value={data ? String(data.github.prs.length) : "—"}
            note={
              data
                ? `${data.github.repos.length} repo(s)`
                : undefined
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? "bg-[var(--ink)] text-[var(--bg)]"
                  : "text-[var(--muted-fg)] hover:bg-[var(--surface)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "status" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Connection map
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {(data?.connections ?? []).map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-[var(--line)] px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={connectionHealth(c.wire)} />
                    <h4 className="font-[family-name:var(--font-display)] font-semibold">
                      {c.name}
                    </h4>
                  </div>
                  <span className="text-xs text-[var(--muted-fg)]">
                    {WIRE_LABEL[c.wire]}
                  </span>
                </div>
                <p className="mt-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                  {c.kind}
                  {c.mcpAvailable ? " · MCP" : ""}
                </p>
                <p className="mt-2 text-sm text-[var(--muted-fg)]">{c.detail}</p>
                {c.lastSync ? (
                  <p className="mt-1 text-xs text-[var(--muted-fg)]">
                    Synced <When at={c.lastSync} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "mail" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Inbox digest
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {data?.mail.unread ?? 0} unread · Gmail MCP → ingest
          </p>
          <ul className="mt-4 space-y-2">
            {(data?.mail.threads ?? []).map((t) => (
              <li
                key={t.id}
                className="rounded-xl border border-[var(--line)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {t.unread ? <StatusDot status="warn" /> : <StatusDot status="idle" />}
                    <span className="font-medium">{t.subject}</span>
                    {t.important ? (
                      <span className="text-xs text-[var(--accent-ink)]">!</span>
                    ) : null}
                  </div>
                  <span className="text-xs text-[var(--muted-fg)]">{t.when}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted-fg)]">
                  {t.from} — {t.snippet}
                </p>
                {t.label ? (
                  <p className="mt-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                    {t.label}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "github" && (
        <div className="space-y-4">
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Repos
            </h3>
            <ul className="mt-3 space-y-2">
              {(data?.github.repos ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusDot status={r.ci} />
                      <span className="font-medium">{r.name}</span>
                      {r.private ? (
                        <span className="text-xs text-[var(--muted-fg)]">private</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--muted-fg)]">
                      {r.openPrs} PRs · {r.openIssues} issues · push {r.lastPush}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Open PRs
            </h3>
            <ul className="mt-3 space-y-2">
              {(data?.github.prs ?? []).map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={p.ci} />
                    <span className="font-medium">
                      #{p.number} {p.title}
                    </span>
                  </div>
                  <p className="mt-1 text-[var(--muted-fg)]">
                    {p.repo} · {p.author} · {p.updated}
                  </p>
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-[var(--accent-ink)] underline"
                    >
                      Open on GitHub
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Notion
            </h3>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {data?.notion.connected ? "Connected" : "Not connected"} —{" "}
              {data?.notion.note}
            </p>
            <ul className="mt-3 space-y-2">
              {(data?.notion.pages ?? []).map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <p className="font-medium">{p.title}</p>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {p.kind} · {p.space ?? "—"} · {p.updated}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h3 className="font-[family-name:var(--font-display)] font-semibold">
              Joplin
            </h3>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {data?.joplin.connected ? "Connected" : "Waiting for agent data"} —{" "}
              {data?.joplin.note}
            </p>
            <ul className="mt-3 space-y-2">
              {(data?.joplin.notes ?? []).map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <p className="font-medium">{n.title}</p>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {n.notebook} · {n.updated}
                    {n.tags?.length ? ` · ${n.tags.join(", ")}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === "files" && (
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Google Drive
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {data?.gdrive.note}
            {" · "}
            Other file providers stay on the status tab until connected.
          </p>
          <ul className="mt-4 space-y-2">
            {(data?.gdrive.files ?? []).map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
              >
                <div>
                  <p className="font-medium">{f.name}</p>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {f.mime}
                    {f.path ? ` · ${f.path}` : ""}
                    {f.shared ? " · shared" : ""}
                  </p>
                </div>
                <span className="text-xs text-[var(--muted-fg)]">
                  {f.modified}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Alerts
          </h3>
          <ul className="mt-3 space-y-2">
            {(data?.alerts ?? []).map((a) => (
              <li
                key={a.id}
                className="flex gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
              >
                <StatusDot status={a.severity} className="mt-1.5" />
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-[var(--muted-fg)]">{a.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <details className="panel">
          <summary className="cursor-pointer font-[family-name:var(--font-display)] font-semibold">
            For agents: sync from MCP / n8n
          </summary>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">
            POST to{" "}
            <code className="text-[var(--ink)]">
              {data?.ingest.path ?? "/api/connections/ingest"}
            </code>
            . Grok Bot or Cursor MCP can read Gmail, GitHub, Notion and Drive
            and push a digest here.
          </p>
          <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 p-3 text-xs whitespace-pre-wrap">{`{
  "reportedBy": "grok-bot",
  "mail": {
    "unread": 3,
    "important": 1,
    "threads": [{
      "id": "x1",
      "from": "GitHub",
      "subject": "CI passed",
      "snippet": "All checks green",
      "when": "10m ago",
      "unread": true
    }]
  },
  "notion": { "connected": true, "pages": [] },
  "joplin": { "connected": true, "noteCount": 42, "notes": [] }
}`}</pre>
        </details>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 px-4 py-3">
      <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
        {label}
      </p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
        {value}
      </p>
      {note ? (
        <p className="mt-1 text-xs text-[var(--muted-fg)]">{note}</p>
      ) : null}
    </div>
  );
}
