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

/** Calendar surface page header: eyebrow, title, primary CTA, and the
 *  `LensTabs` row passed in as `children`. */
export function CalendarSurfaceHeader({
  eyebrow,
  eyebrowTone,
  title,
  cta,
  children,
  className,
}: CalendarSurfaceHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className={cn('text-xs font-semibold uppercase tracking-wide', TONE_TEXT[eyebrowTone])}>{eyebrow}</p>
          <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        </div>
        {cta && <div className="shrink-0">{cta}</div>}
      </div>
      {children && <div>{children}</div>}
    </div>
  );
}
