import { demoLifeItems } from "@/lib/demo/fixture";
import { isDemoMode } from "@/lib/security/config";
import type { DashboardData } from "./types";
import { getBoard, type BoardOverlay } from "@/lib/board/store";
import { DEFAULT_FX } from "@/lib/currency/fx";
import { finishDashboard } from "./alerts";

/** Neutral sample mission-control snapshot (no real org data).
 *  Swap this module for live API pulls (OpenClaw, Stripe, social, etc.). */
export const dashboardData: DashboardData = {
  fx: DEFAULT_FX,
  costs: {
    dailyBurnUsd: 0.4,
    weeklyBurnUsd: 2.8,
    monthlyBurnUsd: 12,
    budgetDailyUsd: 1,
    llmDailyUsd: 0.4,
    mcpDailyUsd: 0.2,
    status: "ok",
  },
  money: {
    subMonthlySek: 0,
    expenseMonthSek: 0,
    incomeMonthSek: 0,
    bufferSek: 0,
    billsDueSoon: 0,
    sellActive: 0,
    sellSoldMonthSek: 0,
    status: "warn",
  },
  connections: {
    live: 0,
    mcpReady: 0,
    missing: 0,
    unreadMail: 0,
    openPrs: 0,
    status: "warn",
  },
  generatedAt: new Date().toISOString(),
  mode: "almost-free",
  mission: {
    tagline: "Run a small company with a team of AI agents.",
    runwayGoal: "Cover LLM API costs first, then grow.",
    apiCostTarget: "$0 net API burn",
    vanlifeProgress: 12,
  },
  pulse: [
    {
      id: "agents-online",
      label: "Agents online",
      value: "25",
      target: "25",
      trend: "flat",
      note: "Full org roster",
      status: "ok",
    },
    {
      id: "api-burn",
      label: "API burn (est.)",
      value: "$0.40/d",
      target: "< $1/d",
      money: { value: 0.4, currency: "USD", per: "/d", target: 1, targetPrefix: "< " },
      trend: "down",
      delta: "−92%",
      note: "Low-cost mode",
      status: "ok",
    },
    {
      id: "mrr",
      label: "MRR",
      value: "$0",
      target: "$49+",
      money: { value: 0, currency: "USD", target: 49, targetSuffix: "+" },
      trend: "flat",
      note: "First dollar pending",
      status: "warn",
    },
    {
      id: "content-out",
      label: "Content shipped (7d)",
      value: "1",
      target: "5",
      trend: "up",
      delta: "+1",
      note: "Sample content",
      status: "warn",
    },
    {
      id: "focus",
      label: "CEO focus debt",
      value: "3",
      target: "0",
      trend: "down",
      note: "Decisions waiting",
      status: "warn",
    },
  ],
  kpis: [
    {
      id: "mrr-kpi",
      label: "MRR",
      value: "$0",
      target: "$500",
      money: { value: 0, currency: "USD", target: 500 },
      trend: "flat",
      note: "Subscriptions normalized monthly",
    },
    {
      id: "nrr",
      label: "NRR",
      value: "—",
      target: ">100%",
      trend: "flat",
      note: "Needs first cohort",
    },
    {
      id: "cac",
      label: "CAC",
      value: "—",
      target: "< LTV/3",
      trend: "flat",
      note: "No paid acquisition yet",
    },
    {
      id: "activation",
      label: "Activation",
      value: "—",
      target: "40%",
      trend: "flat",
      note: "Define activation event",
    },
    {
      id: "mau",
      label: "MAU",
      value: "0",
      target: "100",
      trend: "flat",
      note: "Meaningful actions only",
    },
  ],
  agents: [
    {
      id: "muddy",
      name: "Muddy",
      role: "COO",
      dept: "coo",
      status: "ok",
      focus: "Coordination · daily standup",
      lastActive: "12m ago",
    },
    {
      id: "elon",
      name: "Elon",
      role: "CTO",
      dept: "cto",
      status: "ok",
      focus: "Sprint planning",
      lastActive: "28m ago",
    },
    {
      id: "gary",
      name: "Gary",
      role: "CMO",
      dept: "cmo",
      status: "ok",
      focus: "Content pipeline",
      lastActive: "1h ago",
    },
    {
      id: "warren",
      name: "Warren",
      role: "CRO",
      dept: "cro",
      status: "warn",
      focus: "Waiting on goals",
      lastActive: "2h ago",
    },
    {
      id: "atlas",
      name: "Atlas",
      role: "Backend",
      dept: "engineering",
      status: "idle",
      focus: "Standby",
      lastActive: "1d ago",
    },
    {
      id: "shield",
      name: "Shield",
      role: "Security",
      dept: "engineering",
      status: "ok",
      focus: "Daily scan",
      lastActive: "6h ago",
    },
    {
      id: "pixel",
      name: "Pixel",
      role: "Frontend",
      dept: "engineering",
      status: "idle",
      focus: "UI backlog queued",
      lastActive: "2d ago",
    },
    {
      id: "pipeline",
      name: "Pipeline",
      role: "DevOps",
      dept: "engineering",
      status: "ok",
      focus: "Infra health checks",
      lastActive: "3h ago",
    },
    {
      id: "probe",
      name: "Probe",
      role: "QA",
      dept: "engineering",
      status: "idle",
      focus: "Awaiting deployables",
      lastActive: "3d ago",
    },
    {
      id: "quill",
      name: "Quill",
      role: "Blog",
      dept: "marketing",
      status: "ok",
      focus: "Post published",
      lastActive: "4h ago",
    },
    {
      id: "thread",
      name: "Thread",
      role: "Social",
      dept: "marketing",
      status: "warn",
      focus: "Queue needs approval",
      lastActive: "5h ago",
    },
    {
      id: "digest",
      name: "Digest",
      role: "Newsletter",
      dept: "marketing",
      status: "idle",
      focus: "List not live",
      lastActive: "5d ago",
    },
    {
      id: "script",
      name: "Script",
      role: "Video",
      dept: "marketing",
      status: "idle",
      focus: "Script backlog cold",
      lastActive: "5d ago",
    },
    {
      id: "echo",
      name: "Echo",
      role: "SEO",
      dept: "marketing",
      status: "idle",
      focus: "Keyword map draft",
      lastActive: "4d ago",
    },
    {
      id: "canvas-agent",
      name: "Canvas",
      role: "Design",
      dept: "marketing",
      status: "idle",
      focus: "Brand kit pending",
      lastActive: "4d ago",
    },
    {
      id: "lens",
      name: "Lens",
      role: "Visual",
      dept: "marketing",
      status: "idle",
      focus: "Visual system",
      lastActive: "4d ago",
    },
    {
      id: "radar",
      name: "Radar",
      role: "Intel",
      dept: "marketing",
      status: "error",
      focus: "Job error",
      lastActive: "8h ago",
    },
    {
      id: "forge",
      name: "Forge",
      role: "Product",
      dept: "revenue",
      status: "ok",
      focus: "Product scope",
      lastActive: "1d ago",
    },
    {
      id: "compass",
      name: "Compass",
      role: "UX Research",
      dept: "revenue",
      status: "idle",
      focus: "Interview backlog empty",
      lastActive: "5d ago",
    },
    {
      id: "funnel",
      name: "Funnel",
      role: "Growth",
      dept: "revenue",
      status: "warn",
      focus: "Experiment backlog ready",
      lastActive: "1d ago",
    },
    {
      id: "signal",
      name: "Signal",
      role: "Analytics",
      dept: "revenue",
      status: "ok",
      focus: "KPI framework",
      lastActive: "6h ago",
    },
    {
      id: "bridge",
      name: "Bridge",
      role: "Partnerships",
      dept: "revenue",
      status: "idle",
      focus: "Partner plan",
      lastActive: "3d ago",
    },
    {
      id: "harbor",
      name: "Harbor",
      role: "Community",
      dept: "community",
      status: "ok",
      focus: "Community pulse",
      lastActive: "14h ago",
    },
    {
      id: "beacon",
      name: "Beacon",
      role: "DevRel",
      dept: "community",
      status: "idle",
      focus: "Backlog",
      lastActive: "5d ago",
    },
    {
      id: "pulse",
      name: "Pulse",
      role: "Support",
      dept: "community",
      status: "idle",
      focus: "Support queue",
      lastActive: "5d ago",
    },
  ],
  crons: [
    {
      id: "backup",
      name: "GitHub Backup",
      agent: "main",
      schedule: "Every 1h",
      status: "ok",
      lastRun: "38m ago",
    },
    {
      id: "intel",
      name: "Market Intelligence",
      agent: "radar",
      schedule: "Every 2h",
      status: "error",
      lastRun: "failed",
    },
    {
      id: "infra",
      name: "Infra Health",
      agent: "pipeline",
      schedule: "Every 6h",
      status: "ok",
      lastRun: "3h ago",
    },
    {
      id: "security",
      name: "Security Scan",
      agent: "shield",
      schedule: "Daily 06:00 UTC",
      status: "idle",
      lastRun: "paused (free mode)",
    },
    {
      id: "content",
      name: "Content Pipeline",
      agent: "gary",
      schedule: "Daily 09:00 UTC",
      status: "idle",
      lastRun: "paused (free mode)",
    },
    {
      id: "standup",
      name: "Exec Standup",
      agent: "muddy",
      schedule: "Daily 09:30 UTC",
      status: "idle",
      lastRun: "paused (free mode)",
    },
    {
      id: "community",
      name: "Community Pulse",
      agent: "harbor",
      schedule: "Daily 10:00 UTC",
      status: "ok",
      lastRun: "14h ago",
    },
    {
      id: "growth",
      name: "Weekly Growth",
      agent: "warren",
      schedule: "Mon 08:00 UTC",
      status: "idle",
      lastRun: "paused (free mode)",
    },
  ],
  content: [
    { id: "c1", title: "Sample post: how the agent team works", channel: "blog", owner: "Quill", stage: "published", due: "Shipped" },
    { id: "c2", title: "Sample post: keeping API costs low", channel: "blog", owner: "Quill", stage: "draft", due: "Wed" },
    { id: "c3", title: "Sample thread: one week with an agent team", channel: "social", owner: "Thread", stage: "review", due: "Needs you" },
    { id: "c4", title: "Sample newsletter #1", channel: "newsletter", owner: "Digest", stage: "idea", due: "Fri" },
    { id: "c5", title: "Sample 60s explainer video", channel: "video", owner: "Script", stage: "idea", due: "Next week" },
    { id: "c6", title: "Sample keyword cluster", channel: "seo", owner: "Echo", stage: "draft", due: "Thu" },
  ],
  social: [
    { id: "s1", platform: "x", status: "needs-approval", preview: "Sample post: what an AI agent team looks like.", when: "Awaiting review" },
    { id: "s2", platform: "linkedin", status: "queued", preview: "Sample post: three ways to keep API costs down.", when: "Tomorrow 09:00" },
    { id: "s3", platform: "x", status: "live", preview: "Sample post: the dashboard is live.", when: "2d ago", metrics: { likes: 10, views: 400, comments: 2 } },
    { id: "s4", platform: "tiktok", status: "queued", preview: "Sample short: a day with the agent team.", when: "Fri 18:00" },
    { id: "s5", platform: "youtube", status: "failed", preview: "Sample upload blocked: channel not connected", when: "—" },
  ],
  income: [
    { id: "i1", name: "Sample SaaS product", type: "saas", mrr: 0, status: "warn", nextAction: "Ship the first paid plan" },
    { id: "i2", name: "Sample affiliate program", type: "affiliate", mrr: 0, status: "idle", nextAction: "Publish a review page" },
    { id: "i3", name: "Sample freelance leads", type: "freelance", mrr: 0, status: "warn", nextAction: "Follow up one sample lead" },
    { id: "i4", name: "Sample digital product", type: "product", mrr: 0, status: "idle", nextAction: "Write the product brief" },
  ],
  life: demoLifeItems(),
  integrations: [
    { id: "gh", name: "GitHub", status: "ok", detail: "Sample repo connected" },
    { id: "tg", name: "Telegram", status: "ok", detail: "Sample bot connected" },
    { id: "trello", name: "Trello", status: "error", detail: "Sample token expired" },
    { id: "notion", name: "Notion", status: "idle", detail: "Not connected" },
    { id: "stripe", name: "Stripe", status: "idle", detail: "Not connected" },
    { id: "x", name: "X / Twitter", status: "warn", detail: "Manual publish" },
  ],
  alerts: [
    { id: "a1", severity: "error", title: "Sample cron failing", body: "A sample scheduled job needs a fix.", when: "8h ago", section: "system" },
    { id: "a2", severity: "warn", title: "Sample decisions waiting", body: "Two sample decisions wait on the operator.", when: "1d ago" },
    { id: "a3", severity: "warn", title: "Sample post needs approval", body: "One sample post waits for review.", when: "5h ago", section: "social" },
    { id: "a4", severity: "ok", title: "Sample budget holding", body: "Sample burn is under the daily cap.", when: "Active", section: "costs" },
  ],
  system: {
    uptime: "Sample uptime",
    memory: "Healthy",
    disk: "Healthy",
    gateway: "ok",
    cpu: "Low",
  },
  schedule: [
    { time: "06:00", title: "Security scan", owner: "Shield" },
    { time: "09:00", title: "Content pipeline", owner: "Gary" },
    { time: "09:30", title: "Exec standup", owner: "Muddy" },
    { time: "10:00", title: "Community pulse", owner: "Harbor" },
    { time: "Mon 08:00", title: "Weekly growth", owner: "Warren" },
    { time: "Mon 14:00", title: "Sprint planning", owner: "Elon" },
  ],
};

/** Pulse tiles that come from live data; the rest of the seed's tiles are demo-only. */
const LIVE_PULSE = new Set(["agents-online", "api-burn", "mrr"]);

function relativeTime(iso: string | undefined): string {
  const ms = iso ? Date.now() - Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return "—";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

/**
 * The production starting point: the real agent roster and mission text,
 * plus whatever agents reported through "board" ingest. Nothing from the
 * demo sample (cron results, content, income, alerts, KPIs) is shown as if
 * it were real; an unreported section stays empty.
 */
export function liveDashboardBase(board: BoardOverlay): DashboardData {
  const reports = new Map(board.agents.map((a) => [a.id, a]));
  const roster = dashboardData.agents.map((agent) => {
    const r = reports.get(agent.id);
    if (!r) return { ...agent, status: "idle" as const, lastActive: "No report yet" };
    reports.delete(agent.id);
    return {
      ...agent,
      status: r.status,
      focus: r.focus?.trim() || agent.focus,
      lastActive: relativeTime(r.lastActive),
    };
  });
  // Agents that report in but are not on the roster still show up.
  const extra = Array.from(reports.values()).map((r) => ({
    id: r.id,
    name: r.id,
    role: "Agent",
    dept: "engineering" as const,
    status: r.status,
    focus: r.focus?.trim() || "",
    lastActive: relativeTime(r.lastActive),
  }));
  return {
    ...dashboardData,
    generatedAt: new Date().toISOString(),
    mission: { ...dashboardData.mission, vanlifeProgress: board.vanlifeProgress },
    pulse: dashboardData.pulse.filter((p) => LIVE_PULSE.has(p.id)),
    kpis: board.kpis ?? [],
    agents: [...roster, ...extra],
    crons: board.crons ?? [],
    content: board.content ?? [],
    social: board.social ?? [],
    income: board.income ?? [],
    life: board.life ?? [],
    integrations: [],
    alerts: [],
    system: {
      uptime: board.system?.uptime ?? "—",
      memory: board.system?.memory ?? "—",
      disk: board.system?.disk ?? "—",
      cpu: board.system?.cpu ?? "—",
      gateway: board.system?.gateway ?? "idle",
    },
    schedule: board.schedule ?? [],
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  let base: DashboardData;
  if (isDemoMode()) {
    base = {
      ...dashboardData,
      life: demoLifeItems(),
      generatedAt: new Date().toISOString(),
    };
  } else {
    let board: BoardOverlay | null = null;
    try {
      board = await getBoard();
    } catch {
      /* storage down: show the roster with nothing reported */
    }
    base = liveDashboardBase(board ?? { updatedAt: "", agents: [] });
  }

  try {
    const { getCostSnapshot, categoryTotals } = await import(
      "@/lib/costs/store"
    );
    const snap = await getCostSnapshot();
    const cats = categoryTotals(snap.lines);
    const status =
      snap.dailyBurnUsd > snap.budget.dailyUsd
        ? ("error" as const)
        : snap.dailyBurnUsd > snap.budget.dailyUsd * 0.8
          ? ("warn" as const)
          : ("ok" as const);

    base = {
      ...base,
      mode: snap.mode,
      costs: {
        dailyBurnUsd: snap.dailyBurnUsd,
        weeklyBurnUsd: snap.weeklyBurnUsd,
        monthlyBurnUsd: snap.monthlyBurnUsd,
        budgetDailyUsd: snap.budget.dailyUsd,
        llmDailyUsd: cats.llm ?? 0,
        mcpDailyUsd: cats.mcp ?? 0,
        status,
      },
      pulse: base.pulse.map((p) => {
        if (p.id !== "api-burn") return p;
        return {
          ...p,
          value: `$${snap.dailyBurnUsd.toFixed(2)}/d`,
          target: `< $${snap.budget.dailyUsd}/d`,
          money: {
            value: snap.dailyBurnUsd,
            currency: "USD" as const,
            per: "/d",
            target: snap.budget.dailyUsd,
            targetPrefix: "< ",
            breakdown: [
              { label: "LLM", value: cats.llm ?? 0 },
              { label: "MCP", value: cats.mcp ?? 0 },
            ],
          },
          status,
          note: `LLM $${(cats.llm ?? 0).toFixed(2)} · MCP $${(cats.mcp ?? 0).toFixed(2)}`,
          // The seed's "-92%" is demo text, not a measured change.
          delta: undefined,
          trend:
            snap.dailyBurnUsd <= snap.budget.dailyUsd ? "down" : ("up" as const),
        };
      }),
      alerts: [
        ...snap.alerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          title: a.title,
          body: a.body,
          at: snap.updatedAt,
          section: "costs" as const,
        })),
        ...base.alerts,
      ],
    };
  } catch {
    /* keep seed costs */
  }

  try {
    const { getMoneySnapshot } = await import("@/lib/money/store");
    const money = await getMoneySnapshot();
    const mStatus =
      money.everydaySummary.incomeMonth <= 0
        ? ("error" as const)
        : money.everydaySummary.billsDueSoon > 0
          ? ("warn" as const)
          : ("ok" as const);

    base = {
      ...base,
      fx: {
        usdToSek: money.usdToSek,
        eurToSek: money.eurToSek,
        source: money.fxSource,
        ...(money.fxSources ? { sources: money.fxSources } : {}),
        ...(money.riksbankDate ? { riksbankDate: money.riksbankDate } : {}),
      },
      money: {
        subMonthlySek: money.subMonthlySek,
        expenseMonthSek: money.everydaySummary.expenseMonth,
        incomeMonthSek: money.everydaySummary.incomeMonth,
        bufferSek: money.everydaySummary.bufferSek,
        billsDueSoon: money.everydaySummary.billsDueSoon,
        sellActive: money.sellPipeline.activeListings,
        sellSoldMonthSek: money.sellPipeline.soldThisMonth,
        status: mStatus,
      },
      pulse: [
        ...base.pulse,
        ...(money.subscriptions.length ? [{
          id: "subs-burn",
          label: "Subscriptions / mo",
          value: formatSek(money.subMonthlySek),
          money: {
            value: money.subMonthlySek,
            currency: "SEK" as const,
            per: "/mo",
          },
          target: "cut fat",
          trend: "flat" as const,
          note: `${money.subscriptions.filter((s) => s.status === "active").length} active`,
          status: money.subscriptions.some((s) => s.status === "cancel-soon")
            ? ("warn" as const)
            : ("ok" as const),
        }] : []),
      ].slice(0, 6),
      alerts: [
        ...money.alerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          title: a.title,
          body: a.body,
          at: money.updatedAt,
          section: "money" as const,
        })),
        ...base.alerts,
      ],
    };
  } catch {
    /* keep seed money */
  }

  try {
    const { getConnectionsSnapshot } = await import(
      "@/lib/connections/store"
    );
    const conn = await getConnectionsSnapshot();
    const live = conn.connections.filter((c) => c.wire === "live").length;
    const mcpReady = conn.connections.filter(
      (c) => c.wire === "mcp-ready" || c.wire === "ingest-only",
    ).length;
    const missing = conn.connections.filter((c) => c.wire === "missing").length;
    // Optional services that are not connected are not a problem.
    const broken = conn.connections.some((c) => c.wire === "error");
    const cStatus = broken
      ? ("error" as const)
      : conn.mail.important > 0
        ? ("warn" as const)
        : live > 0
          ? ("ok" as const)
          : ("idle" as const);

    base = {
      ...base,
      connections: {
        live,
        mcpReady,
        missing,
        unreadMail: conn.mail.unread,
        openPrs: conn.github.prs.length,
        status: cStatus,
      },
      alerts: [
        ...conn.alerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          title: a.title,
          body: a.body,
          at: conn.updatedAt,
          section: "connections" as const,
        })),
        ...base.alerts,
      ],
    };
  } catch {
    /* keep seed connections */
  }

  try {
    const { getBridgeState } = await import("@/lib/bots/store");
    const { mergeBotState } = await import("@/lib/bots/merge");
    base = mergeBotState(base, await getBridgeState());
  } catch {
    /* keep base without live bot state */
  }

  return finishDashboard(base);
}

function formatSek(n: number): string {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(n);
}
