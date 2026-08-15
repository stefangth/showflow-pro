import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CalendarToolbarProps {
  children: ReactNode;
  className?: string;
}

/** Toolbar row beneath the surface header — houses the `PeriodNavigator`,
 *  filter chips, and "Add filter" control. Purely a layout shell. */
export function CalendarToolbar({ children, className }: CalendarToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3',
        className
      )}
    >
      {children}
    </div>
  );
}
