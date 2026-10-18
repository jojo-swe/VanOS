import type { HealthStatus } from "@/lib/dashboard/types";

const map: Record<HealthStatus, string> = {
  ok: "bg-[var(--ok)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--ok)_25%,transparent)]",
  warn: "bg-[var(--warn)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--warn)_25%,transparent)]",
  error:
    "bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_25%,transparent)]",
  idle: "bg-[var(--muted-fg)]/35",
};

export const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: "OK",
  warn: "Needs attention",
  error: "Broken",
  idle: "Idle",
};

export function StatusDot({
  status,
  className = "",
}: {
  status: HealthStatus;
  className?: string;
}) {
  return (
    <span
      role="img"
      className={`inline-block size-2.5 shrink-0 rounded-sm ${map[status]} ${className}`}
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  );
}
