import { demoBanner } from "@/lib/demo/mode";
import { isDemoMode } from "@/lib/security/config";

/** Visible on every page while VANOS_DEMO_MODE=true. */
export function DemoBanner() {
  if (!isDemoMode()) return null;
  const banner = demoBanner();
  return (
    <div
      role="status"
      data-demo-banner
      className="relative z-40 border-b border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <strong className="rounded-md bg-[var(--ink)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--bg)]">
          {banner.label}
        </strong>
        <span>{banner.body}</span>
        {banner.href ? (
          <a
            href={banner.href}
            className="font-semibold text-[var(--accent-ink)] underline"
          >
            {banner.link}
          </a>
        ) : null}
      </div>
    </div>
  );
}
