import type { SectionBadge } from "./sections";

export function NavBadge({ badge }: { badge?: SectionBadge }) {
  if (!badge) return null;
  const tone =
    badge.tone === "error"
      ? "bg-[var(--danger)] text-[var(--bg)]"
      : "bg-[var(--warn-soft)] text-[var(--warn-ink)]";
  return (
    <span
      className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums ${tone}`}
      aria-label={`${badge.count} ${badge.tone === "error" ? "broken" : "need attention"}`}
    >
      {badge.count}
    </span>
  );
}
