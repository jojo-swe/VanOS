"use client";

import { useLayoutEffect } from "react";
import { applyThemeChoice, readStoredTheme } from "@/lib/theme/theme";

/**
 * Re-apply the stored choice after hydration. The head script already set
 * `data-theme` for the first paint; this puts it back if hydration resets
 * the server `system` attribute.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyThemeChoice(readStoredTheme());
  }, []);
  return null;
}
