"use client";

import { formatDateTime } from "@/lib/format/time";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { GithubIntegrationSnapshot } from "@/lib/github/types";
import type { NotionIntegrationSnapshot } from "@/lib/notion/types";
import type { ObsidianIntegrationSnapshot } from "@/lib/obsidian/types";
import type { SlackIntegrationSnapshot } from "@/lib/slack/types";
import type { HealthStatus } from "@/lib/dashboard/types";
import { StatusDot } from "./StatusDot";

async function loadJson<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 401) {
      return { data: null, error: "Sign in to view this panel." };
    }
    if (!res.ok) {
      return { data: null, error: `Couldn't load this panel (${res.status}).` };
    }
    return { data: (await res.json()) as T, error: null };
  } catch {
    return { data: null, error: "Couldn't reach Mission Control." };
  }
}

function when(iso?: string) {
  return formatDateTime(iso);
}

function tone(status: HealthStatus) {
  if (status === "error") return "text-[var(--danger)]";
  if (status === "warn") return "text-[var(--warn-ink)]";
  return "text-[var(--muted-fg)]";
}

export function IntegrationsPanel() {
  const [github, setGithub] = useState<GithubIntegrationSnapshot | null>(null);
  const [notion, setNotion] = useState<NotionIntegrationSnapshot | null>(null);
  const [obsidian, setObsidian] = useState<ObsidianIntegrationSnapshot | null>(null);
  const [slack, setSlack] = useState<SlackIntegrationSnapshot | null>(null);
  const [errors, setErrors] = useState<{
    github?: string;
    notion?: string;
    obsidian?: string;
    slack?: string;
  }>({});
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const queryRef = useRef("");

  const refresh = useCallback(async () => {
    const q = queryRef.current;
    const obsidianUrl = q ? `/api/obsidian?q=${encodeURIComponent(q)}` : "/api/obsidian";
    const [gh, no, ob, sl] = await Promise.all([
      loadJson<GithubIntegrationSnapshot>("/api/github"),
      loadJson<NotionIntegrationSnapshot>("/api/notion"),
      loadJson<ObsidianIntegrationSnapshot>(obsidianUrl),
      loadJson<SlackIntegrationSnapshot>("/api/slack"),
    ]);
    setGithub(gh.data);
    setNotion(no.data);
    setObsidian(ob.data);
    setSlack(sl.data);
    setErrors({
      github: gh.error ?? undefined,
      notion: no.error ?? undefined,
      obsidian: ob.error ?? undefined,
      slack: sl.error ?? undefined,
    });
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function searchNotes(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    const q = query.trim();
    queryRef.current = q.length >= 2 ? q : "";
    const result = await loadJson<ObsidianIntegrationSnapshot>(
      queryRef.current ? `/api/obsidian?q=${encodeURIComponent(queryRef.current)}` : "/api/obsidian",
    );
    setObsidian(result.data);
    setErrors((prev) => ({ ...prev, obsidian: result.error ?? undefined }));
    setSearching(false);
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Integrations
            </h2>
            <p className="text-sm text-[var(--muted-fg)]">
              GitHub, Notion, Slack, and Obsidian — read-only, off until their env vars are set
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

      <section className="panel">
        <div className="flex items-center gap-2">
          <StatusDot status={github?.status ?? "idle"} />
          <h3 className="font-[family-name:var(--font-display)] font-semibold">GitHub</h3>
          {github?.owner ? (
            <span className="text-xs text-[var(--muted-fg)]">{github.owner}</span>
          ) : null}
        </div>
        <p className={`mt-1 text-sm ${tone(github?.status ?? "idle")}`}>
          {errors.github ?? github?.detail ?? "Loading…"}
        </p>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div>
            <h4 className="text-xs uppercase tracking-[0.12em] text-[var(--muted-fg)]">Open PRs</h4>
            <ul className="mt-2 space-y-1.5">
              {(github?.openPrs ?? []).map((pr) => (
                <li key={`${pr.repo}#${pr.number}`} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm">
                  <a
                    href={pr.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:text-[var(--accent-ink)]"
                  >
                    {pr.repo}#{pr.number}
                  </a>
                  <p className="text-[var(--muted-fg)]">{pr.title}</p>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {pr.author} · {when(pr.updatedAt)}
                  </p>
                </li>
              ))}
              {github?.configured && !github.openPrs.length ? (
                <li className="text-sm text-[var(--muted-fg)]">No open pull requests.</li>
              ) : null}
            </ul>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-[0.12em] text-[var(--muted-fg)]">Latest commits</h4>
            <ul className="mt-2 space-y-1.5">
              {(github?.commits ?? []).map((commit) => (
                <li key={`${commit.repo}-${commit.sha}`} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm">
                  <a
                    href={commit.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:text-[var(--accent-ink)]"
                  >
                    {commit.repo}@{commit.sha.slice(0, 7)}
                  </a>
                  <p className="text-[var(--muted-fg)]">{commit.message}</p>
                  <p className="text-xs text-[var(--muted-fg)]">
                    {commit.author} · {when(commit.committedAt)}
                  </p>
                </li>
              ))}
              {github?.configured && !github.commits.length ? (
                <li className="text-sm text-[var(--muted-fg)]">No commits returned.</li>
              ) : null}
            </ul>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-[0.12em] text-[var(--muted-fg)]">Failing workflows</h4>
            <ul className="mt-2 space-y-1.5">
              {(github?.failingRuns ?? []).map((run) => (
                <li key={`${run.repo}-${run.name}-${run.updatedAt}`} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm">
                  <a
                    href={run.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[var(--danger)] hover:underline"
                  >
                    {run.name}
                  </a>
                  <p className="text-[var(--muted-fg)]">
                    {run.repo}
                    {run.branch ? ` · ${run.branch}` : ""} · {run.conclusion}
                  </p>
                  <p className="text-xs text-[var(--muted-fg)]">{when(run.updatedAt)}</p>
                </li>
              ))}
              {github?.configured && !github.failingRuns.length ? (
                <li className="text-sm text-[var(--muted-fg)]">No failing runs in the latest workflows.</li>
              ) : null}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center gap-2">
          <StatusDot status={notion?.status ?? "idle"} />
          <h3 className="font-[family-name:var(--font-display)] font-semibold">Notion</h3>
        </div>
        <p className={`mt-1 text-sm ${tone(notion?.status ?? "idle")}`}>
          {errors.notion ?? notion?.detail ?? "Loading…"}
        </p>
        <ul className="mt-3 space-y-1.5">
          {(notion?.rows ?? []).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm"
            >
              <div className="min-w-0">
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--accent-ink)]">
                    {row.title}
                  </a>
                ) : (
                  <span className="font-medium">{row.title}</span>
                )}
                <p className="text-xs text-[var(--muted-fg)]">
                  {row.databaseTitle} · {when(row.editedAt)}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--muted-fg)]">
                {row.status}
              </span>
            </li>
          ))}
          {notion?.configured && !notion.rows.length && notion.status !== "error" ? (
            <li className="text-sm text-[var(--muted-fg)]">
              No open rows. Everything in view is {notion.doneValue}, or the databases are empty.
            </li>
          ) : null}
        </ul>
        {(notion?.databases ?? []).some((db) => db.error) ? (
          <ul className="mt-3 space-y-1 text-sm text-[var(--warn-ink)]">
            {notion?.databases.filter((db) => db.error).map((db) => (
              <li key={db.id}>{db.title}: {db.error}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={slack?.status ?? "idle"} />
          <h3 className="font-[family-name:var(--font-display)] font-semibold">Slack</h3>
          {slack?.workspace ? (
            <span className="text-xs text-[var(--muted-fg)]">{slack.workspace}</span>
          ) : null}
          {slack ? (
            <span className="ml-auto rounded-md bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--muted-fg)]">
              {slack.notifications ? `Alerts on (${slack.notifyLevel})` : "Alerts off"}
            </span>
          ) : null}
        </div>
        <p className={`mt-1 text-sm ${tone(slack?.status ?? "idle")}`}>
          {errors.slack ?? slack?.detail ?? "Loading…"}
        </p>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          {(slack?.channels ?? []).map((channel) => (
            <div key={channel.id}>
              <h4 className="text-xs uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                #{channel.name}
              </h4>
              {channel.error ? (
                <p className="mt-2 text-sm text-[var(--warn-ink)]">{channel.error}</p>
              ) : null}
              <ul className="mt-2 space-y-1.5">
                {channel.messages.map((message) => (
                  <li
                    key={message.ts}
                    className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm"
                  >
                    <p className="break-words">{message.text || "(no text)"}</p>
                    <p className="text-xs text-[var(--muted-fg)]">
                      {message.url ? (
                        <a
                          href={message.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-[var(--accent-ink)]"
                        >
                          {message.author} · {when(message.at)}
                        </a>
                      ) : (
                        <>
                          {message.author} · {when(message.at)}
                        </>
                      )}
                      {message.replies ? ` · ${message.replies} repl${message.replies === 1 ? "y" : "ies"}` : ""}
                    </p>
                  </li>
                ))}
                {!channel.error && !channel.messages.length ? (
                  <li className="text-sm text-[var(--muted-fg)]">No recent messages.</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center gap-2">
          <StatusDot status={obsidian?.status ?? "idle"} />
          <h3 className="font-[family-name:var(--font-display)] font-semibold">Obsidian</h3>
        </div>
        <p className={`mt-1 text-sm ${tone(obsidian?.status ?? "idle")}`}>
          {errors.obsidian ?? obsidian?.detail ?? "Loading…"}
        </p>
        <form onSubmit={(event) => void searchNotes(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1 text-xs text-[var(--muted-fg)]">
            Search notes
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the vault"
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={searching}
              className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              {searching ? "Searching…" : "Search"}
            </button>
            {obsidian?.mode === "search" ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                onClick={() => {
                  queryRef.current = "";
                  setQuery("");
                  void refresh();
                }}
              >
                Recent
              </button>
            ) : null}
          </div>
        </form>
        <ul className="mt-3 space-y-1.5">
          {(obsidian?.notes ?? []).map((note) => (
            <li key={`${note.source}:${note.path}`} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm">
              <p className="font-medium">{note.title}</p>
              <p className="text-xs text-[var(--muted-fg)]">
                {note.path}
                {note.updatedAt ? ` · ${when(note.updatedAt)}` : ""}
              </p>
              {note.excerpt ? <p className="mt-1 text-[var(--muted-fg)]">{note.excerpt}</p> : null}
            </li>
          ))}
          {obsidian?.configured && !obsidian.notes.length && obsidian.status !== "error" ? (
            <li className="text-sm text-[var(--muted-fg)]">
              {obsidian.mode === "search" ? "No notes matched." : "No markdown notes in the vault."}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
