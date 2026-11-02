"use client";

import { needsAttention } from "@/lib/dashboard/alerts";
import type { Alert, DashboardSection } from "@/lib/dashboard/types";
import { SECTION_LABEL } from "./sections";
import { StatusDot } from "./StatusDot";
import { When } from "./When";

function AlertRow({
  alert,
  onOpen,
}: {
  alert: Alert;
  onOpen: (section: DashboardSection) => void;
}) {
  const body = (
    <>
      <StatusDot status={alert.severity} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{alert.title}</p>
        {alert.body ? (
          <p className="text-sm text-[var(--muted-fg)]">{alert.body}</p>
        ) : null}
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--muted-fg)]">
          {alert.at ? (
            <When at={alert.at} />
          ) : alert.when ? (
            <span>{alert.when}</span>
          ) : null}
          {alert.section ? (
            <span className="font-medium text-[var(--accent-ink)]">
              Open {SECTION_LABEL[alert.section]} →
            </span>
          ) : null}
        </p>
      </div>
    </>
  );
  const shell =
    "flex w-full gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-left";
  if (!alert.section) {
    return <li className={shell}>{body}</li>;
  }
  const section = alert.section;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(section)}
        className={`${shell} transition hover:border-[var(--accent)]/40`}
      >
        {body}
      </button>
    </li>
  );
}

/** Things that need a person first; everything fine folded away. */
export function AlertList({
  alerts,
  onOpen,
}: {
  alerts: Alert[];
  onOpen: (section: DashboardSection) => void;
}) {
  const urgent = needsAttention(alerts);
  const rest = alerts.filter((a) => !urgent.includes(a));
  return (
    <div className="mt-3 space-y-3">
      {urgent.length ? (
        <ul className="space-y-2">
          {urgent.map((a) => (
            <AlertRow key={a.id} alert={a} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-3 text-sm">
          <StatusDot status="ok" /> Nothing needs you right now.
        </p>
      )}
      {rest.length ? (
        <details className="group rounded-lg border border-[var(--line)]">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-[var(--muted-fg)] hover:text-[var(--ink)]">
            <span className="inline-flex items-center gap-2">
              <StatusDot status="ok" />
              {rest.length} {rest.length === 1 ? "note" : "notes"}, all fine
              <span aria-hidden className="transition group-open:rotate-90">
                ›
              </span>
            </span>
          </summary>
          <ul className="space-y-2 px-3 pb-3">
            {rest.map((a) => (
              <AlertRow key={a.id} alert={a} onOpen={onOpen} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
