/**
 * Date and time formatting for the dashboard. The UI is in English, but
 * dates use Swedish formatting (2026-10-17 14:05) in the viewer's local
 * time zone. Call these on the client only (after mount): the server's
 * time zone and clock differ from the browser's.
 */

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-10-17 14:05". Empty string for a missing or invalid date. */
export function formatDateTime(value: DateInput, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/** "14:05". Empty string for a missing or invalid date. */
export function formatClock(value: DateInput, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", then the full date.
 * A time slightly in the future (clock skew) reads as "just now".
 */
export function formatRelative(
  value: DateInput,
  nowMs: number,
  timeZone?: string,
): string {
  const d = toDate(value);
  if (!d) return "";
  const diff = nowMs - d.getTime();
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} d ago`;
  return formatDateTime(d, timeZone);
}
