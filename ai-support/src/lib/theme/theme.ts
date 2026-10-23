export const THEME_STORAGE_KEY = "vanos-theme";

export const THEME_CHOICES = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Same-tab signal so every toggle shows the choice the other one just stored. */
export const THEME_CHANGE_EVENT = "vanos-theme-change";

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function readStoredTheme(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/**
 * Apply a theme choice. Pass `persist` only after an explicit user action
 * so a blocked storage read does not write a fallback over a real choice.
 */
export function applyThemeChoice(choice: ThemeChoice, persist = false): void {
  const next = parseThemeChoice(choice);
  document.documentElement.setAttribute("data-theme", next);
  if (!persist) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode or a full quota — the attribute still applies for this view */
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Blocking head script. Runs before first paint so a stored choice wins
 * over the system default without a flash. Keep the branches aligned with
 * `parseThemeChoice`: anything other than light/dark/system is system.
 */
export function buildThemeInitScript(storageKey = THEME_STORAGE_KEY): string {
  const key = JSON.stringify(storageKey);
  return `(function(){try{var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark"&&t!=="system")t="system";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","system");}})();`;
}

export const themeInitScript = buildThemeInitScript();
