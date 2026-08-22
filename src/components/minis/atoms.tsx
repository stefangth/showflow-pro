import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * Shared miniature atoms for page-mini illustrations. All token-only and data-free:
 * they render a small, non-interactive likeness of the real UI, not the real thing.
 * Reused across every page's illustration so the nine minis stay visually consistent.
 */

/** The inner illustration panel (a small "card" inside a step). */
export function MiniCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5 rounded-m border-[0.5px] border-border bg-card p-3', className)}>
      {children}
    </div>
  );
}

/** A labelled field row: muted label on the left, value on the right. */
export function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[92px] shrink-0 text-eyebrow text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-caption font-medium text-foreground">
        {children}
      </span>
    </div>
  );
}

/** A recessed "well" row (e.g. a tier line or a summary chip). */
export function MiniWell({ icon, label, trailing }: { icon?: ReactNode; label: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-s border-[0.5px] border-border bg-muted px-2.5 py-2">
      {icon}
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{label}</span>
      {trailing && <span className="shrink-0 font-mono text-eyebrow text-muted-foreground/80">{trailing}</span>}
    </div>
  );
}

/** A small initials avatar. `tone` is a literal accent-stop bg class (so Tailwind's
 *  scanner sees it) — no brand hues are hardcoded. */
export function MiniAvatar({ initials, tone = 'bg-accent-500' }: { initials: string; tone?: string }) {
  return (
    <span
      className={cn('inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-eyebrow font-semibold text-white', tone)}
    >
      {initials}
    </span>
  );
}

/** A name row with an optional avatar and a trailing status badge. */
export function MiniRow({ avatar, name, sub, trailing }: { avatar?: ReactNode; name: string; sub?: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">{name}</span>
        {sub && <span className="block truncate text-eyebrow text-muted-foreground/70">{sub}</span>}
      </span>
      {trailing}
    </div>
  );
}

/** A small green "done" tick, e.g. a set letterhead. */
export function MiniCheck() {
  return (
    <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent-100">
      <Check className="h-3 w-3 text-accent-text" strokeWidth={3} />
    </span>
  );
}

/** A horizontal fill meter with a trailing mono label. */
export function MiniMeter({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-accent-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <span className="shrink-0 font-mono text-eyebrow tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}

/** A vertical timeline row: initials + detail + time, connected by a hairline. */
export function MiniTimelineRow({ initials, name, detail, time, tone = 'bg-accent-500', last }: { initials: string; name: string; detail: string; time: string; tone?: string; last?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex flex-col items-center">
        <MiniAvatar initials={initials} tone={tone} />
        {!last && <span className="w-px flex-1 min-h-[10px] bg-border" />}
      </span>
      <span className={cn('min-w-0 flex-1', !last && 'pb-2')}>
        <span className="block truncate text-caption text-foreground">
          <span className="font-medium">{name}</span> {detail}
        </span>
        <span className="block font-mono text-eyebrow tabular-nums text-muted-foreground/70">{time}</span>
      </span>
    </div>
  );
}

/** A non-interactive pseudo-button for illustrations (primary = accent fill). */
export function MiniButton({ children, primary }: { children: ReactNode; primary?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center rounded-s border-[0.5px] text-caption font-medium',
        primary
          ? 'border-accent-600 bg-accent-500 text-white'
          : 'border-border bg-card text-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** One week strip of seven day cells. `days` is [{ n, tone }] where tone selects the fill. */
export type DayTone = 'idle' | 'muted' | 'blocked' | 'offer';
export function MiniWeek({ days }: { days: readonly { n: number; tone: DayTone }[] }) {
  const fill: Record<DayTone, string> = {
    idle: 'bg-card border-border text-muted-foreground/70',
    muted: 'bg-muted border-border text-muted-foreground',
    blocked: 'bg-background border-border text-muted-foreground/70 line-through',
    offer: 'bg-accent-500 border-accent-600 text-white',
  };
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d, i) => (
        <span
          key={i}
          className={cn('flex aspect-square items-center justify-center rounded-xs border-[0.5px] font-mono text-eyebrow font-semibold tabular-nums', fill[d.tone])}
        >
          {d.n}
        </span>
      ))}
    </div>
  );
}

export { Badge };
