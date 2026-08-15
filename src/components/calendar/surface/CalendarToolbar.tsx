import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CalendarToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Toolbar row beneath the surface header — houses the `PeriodNavigator`,
 * filter chips, and "Add filter" control. Purely a layout shell: the design
 * has no full-width rule under this row (a short vertical divider between
 * the period-nav group and the filter chips is the caller's concern, drawn
 * inline among `children`).
 */
export function CalendarToolbar({ children, className }: CalendarToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      {children}
    </div>
  );
}
