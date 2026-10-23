"use client";

import { useCallback, useEffect, useState } from "react";
import type { SetupStatus } from "@/lib/sync/types";
import { StatusDot } from "./StatusDot";
import { When } from "./When";

export function SetupPanel() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as SetupStatus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function copyCron() {
    if (!status?.cronHint) return;
    try {
      await navigator.clipboard.writeText(status.cronHint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const sec = status?.security;

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Setup & security
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              Access mode, Tailscale/edge, tokens, digest wire checklist
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

        {error ? (
          <p className="mt-3 text-sm text-[var(--warn-ink)]">{error}</p>
        ) : null}

        {sec ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <SecStat label="Mode" value={sec.mode} />
            <SecStat
              label="UI gate"
              value={
                sec.requireNetworkGate
                  ? "Tailscale/edge"
                  : sec.requireBasicAuth
                    ? "Basic auth"
                    : "Open"
              }
            />
            <SecStat
              label="Public ingest"
              value={sec.publicIngest ? "Bearer open" : "Tailnet only"}
            />
            <SecStat
              label="Private URL"
              value={sec.privateAppUrl ?? "unset"}
            />
          </div>
        ) : null}

        <ul className="mt-4 space-y-2">
          {(status?.checks ?? []).map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5"
            >
              <StatusDot status={c.severity} className="mt-1.5" />
              <div className="min-w-0">
                <p className="font-medium">{c.label}</p>
                <p className="text-sm text-[var(--muted-fg)]">{c.detail}</p>
              </div>
            </li>
          ))}
          {!status && !error ? (
            <li className="text-sm text-[var(--muted-fg)]">Loading…</li>
          ) : null}
        </ul>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Daily digest
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            n8n / Grok / OpenClaw POST to{" "}
            <code className="text-[var(--ink)]">
              {status?.endpoints.digest ?? "/api/v1/sync"}
            </code>{" "}
            with Bearer{" "}
            <code className="text-[var(--ink)]">AGENT_API_TOKEN</code>.
          </p>
          {status?.lastDigest ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-[var(--line)] px-3 py-2">
                <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                  Source
                </dt>
                <dd className="mt-1 font-medium">{status.lastDigest.source}</dd>
              </div>
              <div className="rounded-lg border border-[var(--line)] px-3 py-2">
                <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                  Date
                </dt>
                <dd className="mt-1 font-medium">{status.lastDigest.date}</dd>
              </div>
              <div className="col-span-2 rounded-lg border border-[var(--line)] px-3 py-2">
                <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                  Received
                </dt>
                <dd className="mt-1 font-medium">
                  <When at={status.lastDigest.receivedAt} absolute />
                </dd>
                {status.lastDigest.summary ? (
                  <p className="mt-1 text-[var(--muted-fg)]">
                    {status.lastDigest.summary}
                  </p>
                ) : null}
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted-fg)]">
              No digest recorded yet.
            </p>
          )}
          {status?.lastGrokIngestAt ? (
            <p className="mt-2 text-xs text-[var(--muted-fg)]">
              Last bot ingest{" "}
              <When at={status.lastGrokIngestAt} absolute />
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void copyCron()}
            className="mt-4 rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--bg)]"
          >
            {copied ? "Copied cron hint" : "Copy cron curl"}
          </button>
          {status?.cronHint ? (
            <pre className="mt-3 max-h-36 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/60 p-3 text-xs whitespace-pre-wrap">
              {status.cronHint}
            </pre>
          ) : null}
        </div>

        <div className="panel">
          <h3 className="font-[family-name:var(--font-display)] font-semibold">
            Recommended topology
          </h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--muted-fg)]">
            <li>
              <strong className="text-[var(--ink)]">You → UI:</strong> your VPS
              behind{" "}
              <code className="text-[var(--ink)]">tailscale serve</code> (
              <code className="text-[var(--ink)]">VANOS_ACCESS_MODE=private</code>
              ).
            </li>
            <li>
              <strong className="text-[var(--ink)]">Grok/n8n → ingest:</strong>{" "}
              Vercel (or Funnel) with{" "}
              <code className="text-[var(--ink)]">hybrid</code> + Bearer — set{" "}
              <code className="text-[var(--ink)]">VANOS_PUBLIC_INGEST_URL</code>.
            </li>
            <li>
              Always set{" "}
              <code className="text-[var(--ink)]">DASHBOARD_BASIC_USER</code> /{" "}
              <code className="text-[var(--ink)]">PASSWORD</code>
              {status
                ? status.dashboardAuthConfigured
                  ? " — enabled."
                  : " — missing."
                : "."}
            </li>
            <li>
              Upstash for durable state; see{" "}
              <code className="text-[var(--ink)]">SECURITY.md</code>.
            </li>
          </ol>
          <p className="mt-4 text-xs text-[var(--muted-fg)]">
            Mode {status?.accessMode ?? "…"} · store{" "}
            {status?.durableBackend ?? "…"} · Grok bots{" "}
            {status
              ? `${status.grokBotsConfigured}/${status.grokBotsTotal}`
              : "…"}
          </p>
        </div>
      </section>
    </div>
  );
}

function SecStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-3 py-2">
      <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
        {label}
      </p>
      <p className="mt-1 truncate font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}
