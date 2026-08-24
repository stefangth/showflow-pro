import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CalendarToolbarProps {
  children: ReactNode;
  /** Right-aligned faint mono hint text (design gap-analysis §1, mock line
   *  167) — the toolbar row's per-lens keyboard/interaction cue, e.g.
   *  "⏎ open · Space preview". Omitted entirely when there's nothing to show
   *  for the active lens. */
  keyHint?: string;
  className?: string;
}

/**
 * Toolbar row beneath the surface header — houses the `PeriodNavigator` (or,
 * on the Needs-you lens, the scope-chip row), filter chips, and "Add filter"
 * control. Purely a layout shell for its left-hand `children`: the design
 * has no full-width rule under this row (a short vertical divider between
 * the period-nav group and the filter chips is the caller's concern, drawn
 * inline among `children`). `keyHint`, when given, renders right-aligned on
 * the same row.
 */
export function CalendarToolbar({ children, keyHint, className }: CalendarToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {keyHint && (
        <span
          data-testid="calendar-toolbar-key-hint"
          className="shrink-0 text-eyebrow text-[var(--text-faint)]"
        >
          {keyHint}
        </span>
      )}
    </div>
  );
}
