"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import {
  THEME_CHANGE_EVENT,
  THEME_CHOICES,
  applyThemeChoice,
  readStoredTheme,
  type ThemeChoice,
} from "@/lib/theme/theme";

const LABEL: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle({ idPrefix }: { idPrefix: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useLayoutEffect(() => {
    setChoice(readStoredTheme());
  }, []);

  useEffect(() => {
    const sync = () => setChoice(readStoredTheme());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function select(next: ThemeChoice) {
    applyThemeChoice(next, true);
    setChoice(next);
  }

  function move(from: ThemeChoice, direction: 1 | -1) {
    const index = THEME_CHOICES.indexOf(from);
    const next =
      THEME_CHOICES[(index + direction + THEME_CHOICES.length) % THEME_CHOICES.length];
    select(next);
    document.getElementById(`${idPrefix}-${next}`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface)]/80 p-0.5"
    >
      {THEME_CHOICES.map((option) => {
        const selected = choice === option;
        return (
          <button
            key={option}
            id={`${idPrefix}-${option}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(option)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(option, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(option, -1);
              }
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              selected
                ? "bg-[var(--ink)] text-[var(--bg)]"
                : "text-[var(--muted-fg)] hover:text-[var(--ink)]"
            }`}
          >
            {LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
