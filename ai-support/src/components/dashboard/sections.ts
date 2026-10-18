import type { DashboardSection } from "@/lib/dashboard/types";

export const SECTION_LABEL: Record<DashboardSection, string> = {
  overview: "Overview",
  bots: "Grok Bots",
  costs: "Costs",
  money: "Money",
  connections: "Connections",
  integrations: "Integrations",
  home: "Home / PC",
  agents: "Agents",
  revenue: "Income",
  content: "Content",
  social: "Social",
  life: "Life",
  system: "System",
  setup: "Setup",
};

export function isSection(value: unknown): value is DashboardSection {
  return typeof value === "string" && Object.hasOwn(SECTION_LABEL, value);
}

export type NavGroup = { label: string; items: DashboardSection[] };

/** The menu, grouped so it reads as five or six places instead of fourteen. */
export const NAV_GROUPS: NavGroup[] = [
  { label: "Today", items: ["overview", "life"] },
  { label: "Bots & agents", items: ["bots", "agents"] },
  { label: "Money", items: ["costs", "money", "revenue"] },
  { label: "Growth", items: ["content", "social"] },
  { label: "Home", items: ["home"] },
  { label: "System", items: ["connections", "integrations", "system", "setup"] },
];

export type SectionBadge = { count: number; tone: "error" | "warn" };

/** Open alerts per section, red when any is broken. */
export function sectionBadges(
  alerts: { severity: string; section?: DashboardSection }[],
): Partial<Record<DashboardSection, SectionBadge>> {
  const out: Partial<Record<DashboardSection, SectionBadge>> = {};
  for (const a of alerts) {
    if (!a.section || (a.severity !== "error" && a.severity !== "warn")) continue;
    const prev = out[a.section];
    out[a.section] = {
      count: (prev?.count ?? 0) + 1,
      tone: prev?.tone === "error" || a.severity === "error" ? "error" : "warn",
    };
  }
  return out;
}

/** The URL for a section: Overview is the plain dashboard. */
export function sectionHref(id: DashboardSection): string {
  return id === "overview" ? "/dashboard" : `/dashboard?s=${id}`;
}
