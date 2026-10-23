"use client";

import {
  useDeferredValue,
  useMemo,
  useState,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { needsAttention } from "@/lib/dashboard/alerts";
import type {
  DashboardData,
  DashboardSection,
  HealthStatus,
} from "@/lib/dashboard/types";
import { formatClock } from "@/lib/format/time";
import {
  Amount,
  CurrencyProvider,
  CurrencyToggle,
} from "@/components/currency/CurrencyProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { toSek } from "@/lib/currency/fx";
import { AlertList } from "./AlertList";
import { AutomationPanel } from "./AutomationPanel";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { CostsPanel } from "./CostsPanel";
import { GrokBotsPanel } from "./GrokBotsPanel";
import { MetricTile } from "./MetricTile";
import { MobileNav } from "./MobileNav";
import { MoneyPanel } from "./MoneyPanel";
import { SetupPanel } from "./SetupPanel";
import { NavBadge } from "./NavBadge";
import {
  NAV_GROUPS,
  SECTION_LABEL,
  isSection,
  sectionBadges,
  sectionHref,
} from "./sections";
import { STATUS_LABEL, StatusDot } from "./StatusDot";
import { useNow, When } from "./When";

type SectionId = DashboardSection;

const DEPT_LABEL: Record<string, string> = {
  coo: "Command",
  cto: "Command",
  cmo: "Command",
  cro: "Command",
  engineering: "Engineering",
  marketing: "Marketing",
  revenue: "Revenue",
  community: "Community",
};


function severityLabel(s: HealthStatus) {
  return STATUS_LABEL[s];
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** "06:00" or "Mon 08:00" in UTC, shown in the viewer's local time. */
function utcSlotToLocal(slot: string, now: number | null): string {
  const m = /^(?:(\w{3}) )?(\d{2}):(\d{2})$/.exec(slot);
  if (!m || now === null) return slot;
  const d = new Date(now);
  d.setUTCHours(Number(m[2]), Number(m[3]), 0, 0);
  return `${m[1] ? `${m[1]} ` : ""}${formatClock(d)}`;
}

export function MissionControl({
  initialData,
  initialSection = "overview",
  demo = false,
}: {
  initialData: DashboardData;
  initialSection?: SectionId;
  demo?: boolean;
}) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const now = useNow();
  const clock = now ? `${weekday.format(now)} ${formatClock(now)}` : "";

  useEffect(() => {
    const pull = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) return;
        setData((await res.json()) as DashboardData);
      } catch {
        /* keep last good snapshot */
      }
    };
    const onVisible = () => {
      if (!document.hidden) void pull();
    };
    const id = setInterval(() => void pull(), 20_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // The section lives in the URL (?s=costs), so reload, Back and shared
  // links land on the same place.
  useEffect(() => {
    const onPop = () => {
      const s = new URLSearchParams(window.location.search).get("s");
      setSection(isSection(s) ? s : "overview");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (id: SectionId) => {
    if (id !== section) {
      window.history.pushState(null, "", sectionHref(id));
      setSection(id);
    }
    window.scrollTo({ top: 0 });
  };

  const filteredAgents = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return data.agents;
    return data.agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.focus.toLowerCase().includes(q),
    );
  }, [data.agents, deferredQuery]);

  const incomeTotalSek = data.income.reduce(
    (sum, s) => sum + toSek(s.mrr, s.currency ?? "USD", data.fx),
    0,
  );
  const agentsOk = data.agents.filter((a) => a.status === "ok").length;
  const agentsWarn = data.agents.filter(
    (a) => a.status === "warn" || a.status === "error",
  ).length;
  const activeLabel = SECTION_LABEL[section] ?? "Overview";
  const urgent = needsAttention(data.alerts);
  const badges = sectionBadges(data.alerts);
  const worst: HealthStatus = urgent.some((a) => a.severity === "error")
    ? "error"
    : "warn";
  const pulseLabels = new Set(data.pulse.map((p) => p.label.toLowerCase()));
  const overviewKpis = data.kpis.filter(
    (k) => !pulseLabels.has(k.label.toLowerCase()),
  );

  return (
    <CurrencyProvider fx={data.fx}>
    <div className="dash-shell relative min-h-screen text-[var(--ink)]">
      <div className="dash-atmosphere" aria-hidden />
      <div className="dash-gridline" aria-hidden />

      <header className="dash-header sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 md:items-baseline md:gap-3">
            <MobileNav
              groups={NAV_GROUPS}
              badges={badges}
              activeId={section}
              onSelect={(id) => go(id as SectionId)}
              clock={clock}
              vanlifeProgress={data.mission.vanlifeProgress}
            />
            <a
              href="/dashboard"
              className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight max-md:inline-flex max-md:min-h-11 max-md:items-center sm:text-2xl"
            >
              Van<span className="text-[var(--accent)]">OS</span>
            </a>
            <span className="min-w-0 truncate text-sm text-[var(--muted-fg)] sm:hidden">
              {activeLabel}
            </span>
            <span className="hidden truncate text-sm text-[var(--muted-fg)] sm:inline">
              Mission Control
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs sm:text-sm">
            <div className="hidden md:block">
              <div className="flex items-center gap-2">
                <CurrencyToggle idPrefix="currency-header" />
                <ThemeToggle idPrefix="theme-header" />
              </div>
            </div>
            <span
              className={`rounded-md px-2 py-1 font-medium ${
                data.mode === "almost-free"
                  ? "bg-[var(--ok-soft)] text-[var(--ok-ink)]"
                  : "bg-[var(--warn-soft)] text-[var(--warn-ink)]"
              }`}
            >
              {data.mode === "almost-free" ? "Almost Free" : "Expensive"}
            </span>
            <span className="hidden tabular-nums text-[var(--muted-fg)] sm:inline">
              {clock}
            </span>
            {demo ? (
              <span className="rounded-md bg-[var(--ink)] px-2 py-1 font-semibold text-[var(--bg)]">
                Demo
              </span>
            ) : (
              <form method="post" action="/api/auth/logout">
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 font-medium text-[var(--muted-fg)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                >
                  Log out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-w-0 max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="dash-nav hidden min-w-0 md:block lg:sticky lg:top-[4.25rem] lg:self-start">
          <nav
            className="flex min-w-0 gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0"
            aria-label="Dashboard sections"
          >
            {NAV_GROUPS.map((group) => (
              <div
                key={group.label}
                className="flex shrink-0 gap-1 lg:flex-col"
                role="group"
                aria-label={group.label}
              >
                <p className="hidden px-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-fg)] lg:block">
                  {group.label}
                </p>
                {group.items.map((id) => {
                  const active = section === id;
                  return (
                    <a
                      key={id}
                      href={sectionHref(id)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        go(id);
                      }}
                      aria-current={active ? "page" : undefined}
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        active
                          ? "bg-[var(--ink)] text-[var(--bg)]"
                          : "text-[var(--muted-fg)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {SECTION_LABEL[id]}
                      <NavBadge badge={badges[id]} />
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>

          {data.mission.vanlifeProgress !== undefined ? (
            <div className="mt-6 hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]/70 p-4 lg:block">
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold">
                Vanlife fund
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-md bg-[var(--line)]">
                <div
                  className="vanlife-bar h-full rounded-md bg-[var(--accent)]"
                  style={
                    {
                      "--vanlife-pct": `${data.mission.vanlifeProgress}%`,
                    } as CSSProperties
                  }
                />
              </div>
              <p className="mt-2 text-xs text-[var(--muted-fg)]">
                {data.mission.vanlifeProgress}% to API-breakeven milestone
              </p>
            </div>
          ) : null}
        </aside>

        <main className="min-w-0 space-y-6">
          {section === "overview" ? (
            <section className="dash-hero relative overflow-hidden rounded-2xl border border-[var(--line)] px-5 py-6 sm:px-8 sm:py-8">
              <div className="dash-hero-wash" aria-hidden />
              <p className="relative font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                VanOS
              </p>
              <h1 className="relative mt-3 max-w-2xl text-lg text-[var(--ink)]/90 sm:text-xl">
                {data.mission.tagline}
              </h1>
              <p className="relative mt-2 max-w-xl text-sm text-[var(--muted-fg)]">
                {data.mission.runwayGoal} · Target: {data.mission.apiCostTarget}
              </p>
              <div className="relative mt-5 flex flex-wrap gap-3 text-xs text-[var(--muted-fg)]">
                {agentsOk + agentsWarn ? (
                  <>
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status="ok" /> {agentsOk} agents OK
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={agentsWarn ? "warn" : "ok"} /> {agentsWarn}{" "}
                      need attention
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <StatusDot status="idle" /> No agent has reported yet
                  </span>
                )}
                <span>
                  Updated <When at={data.generatedAt} />
                </span>
              </div>
            </section>
          ) : urgent.length ? (
            <button
              type="button"
              onClick={() => go("overview")}
              className="flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)]/80 px-4 py-2.5 text-left text-sm transition hover:border-[var(--accent)]/40"
            >
              <StatusDot status={worst} />
              <span className="font-medium">
                {urgent.length} {urgent.length === 1 ? "thing needs" : "things need"} you
              </span>
              <span className="ml-auto text-[var(--accent-ink)]">Overview →</span>
            </button>
          ) : null}

          {section === "bots" && <GrokBotsPanel />}
          {section === "costs" && <CostsPanel />}
          {section === "money" && <MoneyPanel />}
          {section === "connections" && <ConnectionsPanel />}
          {section === "integrations" && <IntegrationsPanel />}
          {section === "home" && <AutomationPanel />}
          {section === "setup" && <SetupPanel />}

          {section === "overview" && (
            <>
              <section className="panel">
                <SectionTitle
                  title="Needs you"
                  subtitle="Broken first, then what needs attention"
                />
                <AlertList alerts={data.alerts} onOpen={go} />
              </section>

              <section>
                <SectionTitle title="Pulse" subtitle="What matters in one glance" />
                <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
                  {data.pulse.map((m, i) => (
                    <MetricTile key={m.id} metric={m} index={i} />
                  ))}
                </div>
              </section>

              <section className="panel">
                <SectionTitle
                  title="Growth KPIs"
                  subtitle="Signal’s five — no vanity metrics"
                />
                {overviewKpis.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {overviewKpis.map((k) => (
                      <div
                        key={k.id}
                        className="rounded-lg border border-[var(--line)] px-3 py-2.5"
                      >
                        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                          {k.label}
                        </p>
                        <p className="font-[family-name:var(--font-display)] text-xl font-semibold">
                          {k.value}
                        </p>
                        <p className="text-xs text-[var(--muted-fg)]">
                          target {k.target} · {k.note}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <NotReported what="KPIs" field="kpis" />
                )}
              </section>

              <section className="panel">
                <SectionTitle title="Today’s spine" subtitle="Schedule, your local time" />
                {data.schedule.length ? (
                  <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {data.schedule.map((s) => (
                      <li
                        key={`${s.time}-${s.title}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-mono text-[var(--accent-ink)]">
                            {utcSlotToLocal(s.time, now)}
                          </span>{" "}
                          {s.title}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--muted-fg)]">
                          {s.owner}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <NotReported what="schedule" field="schedule" />
                )}
              </section>
            </>
          )}

          {section === "agents" && (
            <section className="panel">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <SectionTitle
                  title="Agent fleet"
                  subtitle={`${data.agents.length} agents · filter by name, role, or focus`}
                />
                <label className="block w-full sm:max-w-xs">
                  <span className="sr-only">Search agents</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search agents…"
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base outline-none ring-[var(--accent)] focus:ring-2 sm:text-sm"
                  />
                </label>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {filteredAgents.map((a) => (
                  <article
                    key={a.id}
                    className="agent-card rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-3 transition hover:border-[var(--accent)]/35"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={a.status} />
                        <h3 className="font-[family-name:var(--font-display)] font-semibold">
                          {a.name}
                        </h3>
                      </div>
                      <span className="text-xs text-[var(--muted-fg)]">{a.role}</span>
                    </div>
                    <p className="mt-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                      {DEPT_LABEL[a.dept] ?? a.dept}
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink)]/85">{a.focus}</p>
                    <p className="mt-2 text-xs text-[var(--muted-fg)]">
                      {severityLabel(a.status)} · {a.lastActive}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {section === "revenue" && (
            <>
              <section className="panel">
                <SectionTitle
                  title="Income streams"
                  subtitle={
                    <>
                      Combined MRR <Amount value={incomeTotalSek} from="SEK" /> — first
                      dollar is the mission
                    </>
                  }
                />
                {data.income.length ? (
                  <ul className="mt-4 space-y-3">
                    {data.income.map((stream) => (
                      <li
                        key={stream.id}
                        className="grid gap-2 rounded-xl border border-[var(--line)] p-4 sm:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <StatusDot status={stream.status} />
                            <h3 className="font-semibold">{stream.name}</h3>
                            <span className="text-xs uppercase tracking-wider text-[var(--muted-fg)]">
                              {stream.type}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-[var(--muted-fg)]">
                            Next: {stream.nextAction}
                          </p>
                        </div>
                        <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
                          <Amount value={stream.mrr} from={stream.currency ?? "USD"} />
                          <span className="ml-1 text-xs font-sans font-normal text-[var(--muted-fg)]">
                            /mo
                          </span>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NotReported what="income streams" field="income" />
                )}
              </section>
              <section className="panel">
                <SectionTitle title="KPI board" subtitle="Wire Stripe + product analytics next" />
                {data.kpis.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {data.kpis.map((m, i) => (
                      <MetricTile key={m.id} metric={m} index={i} />
                    ))}
                  </div>
                ) : (
                  <NotReported what="KPIs" field="kpis" />
                )}
              </section>
            </>
          )}

          {section === "content" && (
            <section className="panel">
              <SectionTitle
                title="Content pipeline"
                subtitle="Gary’s dept — idea → published"
              />
              {data.content.length ? (
                <div className="data-table-scroll mt-4 min-w-0 overflow-x-auto">
                  <table className="data-table w-full min-w-[640px] text-left text-sm">
                    <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                      <tr className="border-b border-[var(--line)]">
                        <th className="py-2 pr-3 font-medium">Title</th>
                        <th className="py-2 pr-3 font-medium">Channel</th>
                        <th className="py-2 pr-3 font-medium">Owner</th>
                        <th className="py-2 pr-3 font-medium">Stage</th>
                        <th className="py-2 font-medium">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.content.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-[var(--line)]/70 last:border-0"
                        >
                          <td className="py-3 pr-3 font-medium" data-label="Title">
                            {c.title}
                          </td>
                          <td
                            className="py-3 pr-3 capitalize text-[var(--muted-fg)]"
                            data-label="Channel"
                          >
                            {c.channel}
                          </td>
                          <td className="py-3 pr-3" data-label="Owner">
                            {c.owner}
                          </td>
                          <td className="py-3 pr-3" data-label="Stage">
                            <StageChip stage={c.stage} />
                          </td>
                          <td className="py-3 text-[var(--muted-fg)]" data-label="Due">
                            {c.due}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <NotReported what="content" field="content" />
              )}
            </section>
          )}

          {section === "social" && (
            <section className="panel">
              <SectionTitle
                title="Social queue"
                subtitle="Thread’s board — approve, ship, measure"
              />
              {data.social.length ? (
                <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                  {data.social.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-xl border border-[var(--line)] p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">
                          {p.platform}
                        </span>
                        <SocialStatus status={p.status} />
                      </div>
                      <p className="mt-3 text-sm leading-relaxed">{p.preview}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-fg)]">
                        <span>{p.when}</span>
                        {p.metrics ? (
                          <span>
                            {p.metrics.views ?? 0} views · {p.metrics.likes ?? 0} likes ·{" "}
                            {p.metrics.comments ?? 0} comments
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <NotReported what="social posts" field="social" />
              )}
            </section>
          )}

          {section === "life" && (
            <section className="panel">
              <SectionTitle
                title="Life board"
                subtitle="Now, soon, and someday"
              />
              {data.life.length ? (
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {(["now", "soon", "someday"] as const).map((bucket) => (
                    <div key={bucket}>
                      <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-[0.14em]">
                        {bucket}
                      </h3>
                      <ul className="mt-3 space-y-2">
                        {data.life
                          .filter((l) => l.priority === bucket)
                          .map((l) => (
                            <li
                              key={l.id}
                              className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3"
                            >
                              <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                                {l.area}
                              </p>
                              <p className="mt-1 font-medium">{l.title}</p>
                              <p className="mt-1 text-sm text-[var(--muted-fg)]">
                                {l.detail}
                              </p>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <NotReported what="life items" field="life" />
              )}
            </section>
          )}

          {section === "system" && (
            <>
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="panel">
                  <SectionTitle title="Infrastructure" subtitle="OpenClaw host pulse" />
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <SysStat label="Gateway" value={severityLabel(data.system.gateway)} />
                    <SysStat label="CPU" value={data.system.cpu} />
                    <SysStat label="Memory" value={data.system.memory} />
                    <SysStat label="Disk" value={data.system.disk} />
                    <SysStat label="Uptime" value={data.system.uptime} />
                    <SysStat
                      label="Mode"
                      value={data.mode === "almost-free" ? "Almost Free" : "Expensive"}
                    />
                  </dl>
                </div>
                <div className="panel">
                  <SectionTitle title="Channels" subtitle="Keys and chat channels the agents use" />
                  {data.integrations.length ? (
                    <ul className="mt-3 space-y-2">
                      {data.integrations.map((i) => (
                        <li
                          key={i.id}
                          className="flex items-start gap-3 rounded-lg border border-[var(--line)] px-3 py-2"
                        >
                          <StatusDot status={i.status} className="mt-1.5" />
                          <div>
                            <p className="font-medium">{i.name}</p>
                            <p className="text-sm text-[var(--muted-fg)]">{i.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--muted-fg)]">What is linked is listed under <button type="button" onClick={() => go("connections")} className="font-medium text-[var(--accent-ink)] underline">Connections</button>.</p>
                  )}
                </div>
              </section>
              <section className="panel">
                <SectionTitle title="Cron jobs" subtitle="What still runs in lean mode" />
                {data.crons.length ? (
                  <div className="data-table-scroll mt-3 min-w-0 overflow-x-auto">
                    <table className="data-table w-full min-w-[560px] text-left text-sm">
                      <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                        <tr className="border-b border-[var(--line)]">
                          <th className="py-2 pr-3 font-medium">Job</th>
                          <th className="py-2 pr-3 font-medium">Agent</th>
                          <th className="py-2 pr-3 font-medium">Schedule</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 font-medium">Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.crons.map((c) => (
                          <tr
                            key={c.id}
                            className="border-b border-[var(--line)]/70 last:border-0"
                          >
                            <td className="py-3 pr-3 font-medium" data-label="Job">
                              {c.name}
                            </td>
                            <td className="py-3 pr-3" data-label="Agent">
                              {c.agent}
                            </td>
                            <td
                              className="py-3 pr-3 text-[var(--muted-fg)]"
                              data-label="Schedule"
                            >
                              {c.schedule}
                            </td>
                            <td className="py-3 pr-3" data-label="Status">
                              <span className="inline-flex items-center gap-2">
                                <StatusDot status={c.status} />
                                {severityLabel(c.status)}
                              </span>
                            </td>
                            <td className="py-3 text-[var(--muted-fg)]" data-label="Last">
                              {c.lastRun ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <NotReported what="cron jobs" field="crons" />
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
    </CurrencyProvider>
  );
}

/** An Overview section no agent has reported yet (production only; the demo has samples). */
function NotReported({ what, field }: { what: string; field: string }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted-fg)]">
      <p>No {what} reported yet. Agents fill this in when they report.</p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer hover:text-[var(--ink)]">For agents</summary>
        <p className="mt-1 break-words">
          <code className="text-[var(--ink)]">POST /api/v1/ingest</code> with{" "}
          <code className="text-[var(--ink)]">{`{"domain":"board","${field}":[…]}`}</code>. See
          AGENT-API.md.
        </p>
      </details>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-sm text-[var(--muted-fg)]">{subtitle}</p>
    </div>
  );
}

function StageChip({ stage }: { stage: string }) {
  const tones: Record<string, string> = {
    idea: "bg-[var(--line)] text-[var(--muted-fg)]",
    draft: "bg-[var(--warn-soft)] text-[var(--warn-ink)]",
    review: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
    scheduled: "bg-[var(--ok-soft)] text-[var(--ok-ink)]",
    published: "bg-[var(--ink)] text-[var(--bg)]",
  };
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium capitalize ${tones[stage] ?? tones.idea}`}
    >
      {stage}
    </span>
  );
}

function SocialStatus({
  status,
}: {
  status: "queued" | "live" | "needs-approval" | "failed";
}) {
  const map = {
    queued: { status: "idle" as const, label: "Queued" },
    live: { status: "ok" as const, label: "Live" },
    "needs-approval": { status: "warn" as const, label: "Needs you" },
    failed: { status: "error" as const, label: "Failed" },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <StatusDot status={m.status} />
      {m.label}
    </span>
  );
}

function SysStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-3 py-2">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted-fg)]">
        {label}
      </dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
