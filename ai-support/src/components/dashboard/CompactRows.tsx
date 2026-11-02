import type { ReactNode } from "react";

/**
 * Phone layout for a data table. Below `md` the table is hidden and each
 * row becomes two short lines: what it is and its key number, then the
 * secondary details. From `md` up the table shows instead.
 *
 * Pair it with `TABLE_FROM_MD` on the table's scroll wrapper.
 */
export const TABLE_FROM_MD = "hidden md:block";

export function CompactRows({
  label,
  className = "",
  children,
}: {
  /** Accessible name for the list, usually the table heading. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className={`space-y-2 md:hidden ${className}`}>
      {children}
    </ul>
  );
}

export function CompactRow({
  title,
  value,
  meta,
  footer,
}: {
  /** Line 1, left: the row's name. */
  title: ReactNode;
  /** Line 1, right: the number that matters. */
  value?: ReactNode;
  /** Line 2: status, category, dates. */
  meta?: ReactNode;
  /** Optional actions or a result message, at the end of line 2. */
  footer?: ReactNode;
}) {
  return (
    <li className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate font-medium">{title}</div>
        {value != null ? (
          <div className="shrink-0 tabular-nums font-semibold">{value}</div>
        ) : null}
      </div>
      {meta || footer ? (
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted-fg)]">
            {meta}
          </div>
          {footer ? <div className="ml-auto">{footer}</div> : null}
        </div>
      ) : null}
    </li>
  );
}
