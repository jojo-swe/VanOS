"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { CurrencyToggle } from "@/components/currency/CurrencyProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { DashboardSection } from "@/lib/dashboard/types";
import { NavBadge } from "./NavBadge";
import {
  SECTION_LABEL,
  sectionHref,
  type NavGroup,
  type SectionBadge,
} from "./sections";

export function MobileNav({
  groups,
  badges,
  activeId,
  onSelect,
  clock,
  vanlifeProgress,
}: {
  groups: readonly NavGroup[];
  badges: Partial<Record<DashboardSection, SectionBadge>>;
  activeId: DashboardSection;
  onSelect: (id: DashboardSection) => void;
  clock: string;
  vanlifeProgress?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const desktopNav = useMediaQuery("(min-width: 48rem)");

  useEffect(() => {
    if (desktopNav) dialogRef.current?.close();
  }, [desktopNav]);

  function openDrawer() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setOpen(true);
  }

  function closeDrawer() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--ink)] hover:bg-[var(--surface)] md:hidden"
        aria-label="Open sections"
        aria-expanded={open}
        aria-controls="mobile-section-nav"
        onClick={openDrawer}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        id="mobile-section-nav"
        className="nav-drawer"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDrawer();
        }}
      >
        <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
            <div className="min-w-0">
              <p
                id={titleId}
                className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight"
              >
                Sections
              </p>
              {clock ? (
                <p className="truncate text-xs tabular-nums text-[var(--muted-fg)]">
                  {clock}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--ink)] hover:bg-[var(--bg)]"
              aria-label="Close sections"
              onClick={closeDrawer}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <nav
              className="flex flex-col px-3 py-2"
              aria-label="Dashboard sections"
            >
              {groups.map((group) => (
                <div
                  key={group.label}
                  role="group"
                  aria-label={group.label}
                  className="mb-2"
                >
                  <p className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                    {group.label}
                  </p>
                  {group.items.map((id) => {
                    const active = activeId === id;
                    return (
                      <a
                        key={id}
                        href={sectionHref(id)}
                        aria-current={active ? "page" : undefined}
                        onClick={(e) => {
                          if (
                            e.metaKey ||
                            e.ctrlKey ||
                            e.shiftKey ||
                            e.button !== 0
                          )
                            return;
                          e.preventDefault();
                          onSelect(id);
                          closeDrawer();
                        }}
                        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium ${
                          active
                            ? "bg-[var(--ink)] text-[var(--bg)]"
                            : "text-[var(--muted-fg)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
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

            <div className="border-t border-[var(--line)] px-4 py-3">
              <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-fg)]">
                Theme
              </p>
              <ThemeToggle idPrefix="theme-drawer" />
            <p className="mt-3 mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-fg)]">
              Currency
            </p>
            <CurrencyToggle idPrefix="currency-drawer" />
            </div>

            {vanlifeProgress !== undefined ? (
              <div className="border-t border-[var(--line)] px-4 py-4">
                <p className="font-[family-name:var(--font-display)] text-sm font-semibold">
                  Vanlife fund
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-md bg-[var(--line)]">
                  <div
                    className="vanlife-bar h-full rounded-md bg-[var(--accent)]"
                    style={
                      {
                        "--vanlife-pct": `${vanlifeProgress}%`,
                      } as CSSProperties
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--muted-fg)]">
                  {vanlifeProgress}% to API-breakeven milestone
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
