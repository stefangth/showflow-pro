import { format } from 'date-fns';
import type { ActionGates, ArtistDateEntry, ArtistStatus, ProducerDateEntry } from '@/lib/calendar/types';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { DayDetail } from './DayDetail';

export interface DayRailStat {
  label: string;
  value: string;
  dotClass: string;
}

export interface DayRailLegendItem {
  label: string;
  badgeClass: string;
  railClass: string;
}

interface DayRailProps {
  role: 'producer' | 'artist';
  day: Date;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  stats: DayRailStat[];
  legend: DayRailLegendItem[];
  onPrimary?: () => void;
  primaryLabel?: string;
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Flow-aware artist status label override (see `artistStatusLabel`).
   *  Ignored for `role="producer"`. */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Capability gates for the producer primary action (Confirm holds /
   *  Generate hire order). Ignored for `role="artist"` — artist actions
   *  (accept/decline/block) are not capability-gated. When the resolved
   *  primary action's kind is gated `disabled`, the primary button renders
   *  `disabled` with `title` as its tooltip instead of firing `onPrimary`. */
  actionGates?: ActionGates;
  className?: string;
}

/**
 * Shared right rail for the Month/Agenda lenses: the selected day's date
 * card(s) (`DayDetail`), a stats card, and a Legend card (design lines
 * 655-728). The date card(s) + primary/secondary actions are `DayDetail`
 * (also reused by the mobile day-detail sheet); the stats + legend cards are
 * desktop-only and stay here.
 */
export function DayRail({
  role,
  day,
  producerEntries,
  artistEntries,
  stats,
  legend,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  statusLabels,
  actionGates,
  className,
}: DayRailProps) {
  const statsTitle = role === 'producer' ? 'This month' : `Your ${format(day, 'MMMM')}`;

  return (
    <div data-testid="day-rail" data-day={toDateKey(day)} className={cn('flex flex-col gap-3', className)}>
      <DayDetail
        role={role}
        day={day}
        producerEntries={producerEntries}
        artistEntries={artistEntries}
        onPrimary={onPrimary}
        primaryLabel={primaryLabel}
        onSecondary={onSecondary}
        secondaryLabel={secondaryLabel}
        statusLabels={statusLabels}
        actionGates={actionGates}
      />

      <div className="rounded-m border border-border bg-muted p-3.5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          {statsTitle}
        </p>
        <div className="flex flex-col gap-2">
          {stats.map((stat, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={cn('h-1 w-2.5 shrink-0 rounded-full', stat.dotClass)} />
              <span className="text-[12.5px] text-foreground">{stat.label}</span>
              <span className="ml-auto font-mono text-xs font-medium tabular-nums text-foreground">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-m border border-border bg-card p-3.5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          Legend
        </p>
        <div className="flex flex-col gap-1.5">
          {legend.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="relative h-[11px] w-4 shrink-0 overflow-hidden rounded-[3px]">
                <span className={cn('absolute inset-0', item.badgeClass)} />
                <span className={cn('absolute inset-y-0 left-0 w-0.5', item.railClass)} />
              </span>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
