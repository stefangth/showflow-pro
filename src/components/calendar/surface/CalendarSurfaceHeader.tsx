import type { ReactNode } from 'react';
import type { Tone } from '@/lib/calendar/types';
import { TONE_TEXT } from '@/lib/calendar/tone';
import { cn } from '@/lib/utils';

interface CalendarSurfaceHeaderProps {
  eyebrow: string;
  eyebrowTone: Tone;
  title: string;
  cta?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Calendar surface page header — a single `justify-between` row: eyebrow +
 * title on the left, the `LensTabs` (`children`) then the primary `cta` on
 * the right (design lines 115-135). Title matches this repo's other page
 * titles (`font-display text-[32px] font-semibold tracking-tight`, e.g.
 * `AvailabilityPage`).
 */
export function CalendarSurfaceHeader({
  eyebrow,
  eyebrowTone,
  title,
  cta,
  children,
  className,
}: CalendarSurfaceHeaderProps) {
  return (
    <div
      data-testid="calendar-surface-header-row"
      className={cn('flex items-start justify-between gap-4', className)}
    >
      <div data-testid="calendar-surface-header-left">
        <p className={cn('text-[11px] font-semibold uppercase tracking-[1.6px]', TONE_TEXT[eyebrowTone])}>
          {eyebrow}
        </p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-foreground">{title}</h1>
      </div>
      {(children || cta) && (
        <div data-testid="calendar-surface-header-right" className="flex items-center gap-2">
          {children}
          {cta}
        </div>
      )}
    </div>
  );
}
