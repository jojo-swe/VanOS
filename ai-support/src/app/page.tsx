import Link from "next/link";
import { refuseEdgePage } from "@/lib/security/edge-page";

export const dynamic = "force-dynamic";

export default function Home() {
  refuseEdgePage();
  return (
    <div className="relative min-h-screen overflow-hidden text-[var(--ink)]">
      <div className="dash-atmosphere" aria-hidden />
      <div className="dash-gridline" aria-hidden />

      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <p className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight sm:text-7xl">
          Van<span className="text-[var(--accent)]">OS</span>
        </p>
        <h1 className="mt-4 max-w-2xl text-xl text-[var(--ink)]/90 sm:text-2xl">
          One command center for the company, the bots, the money, and the life
          that funds the road.
        </h1>
        <p className="mt-3 max-w-xl text-[var(--muted-fg)]">
          Agents · income · content · social · systems · personal focus — all in
          Mission Control.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-[var(--bg)] transition hover:bg-[var(--accent-ink)]"
          >
            Open Mission Control
          </Link>
          <Link
            href="/support"
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)]/80 px-5 py-3 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]/40"
          >
            AI Support product
          </Link>
        </div>
      </main>
    </div>
  );
}
