import { useMemo } from 'react';
import { isSameDay } from 'date-fns';
import type { ProducerDateEntry } from '@/lib/calendar/types';
import { toWeekModel, type WeekBlock, type WeekModel } from '@/lib/calendar/weekData';
import { minutesToLabel } from '@/lib/calendar/time';
import { PRODUCER_TONES, TONE_TEXT } from '@/lib/calendar/tone';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { FillMeter } from './FillMeter';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Px per hour of the time grid. Positions/heights are derived from minutes,
 *  so this is layout math, not a color/token concern. */
const HOUR_HEIGHT = 44;
/** Fixed block height (px) — session rows have no duration in the data, so
 *  every block renders the same height regardless of what follows it. */
const BLOCK_HEIGHT = 124;

interface WeekLensProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  onOpenEntry: (entryId: string) => void;
  /** Override for "today", so tests get a deterministic today-column tint
   *  (mirrors the `today` prop on `MonthLens`/`AllDatesLens`/`OffersLens`). */
  today?: Date;
  className?: string;
}

function byColumn<T extends { columnIndex: number }>(items: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const list = map.get(item.columnIndex) ?? [];
    list.push(item);
    map.set(item.columnIndex, list);
  }
  return map;
}

function WeekBlockCard({
  block,
  band,
  heightPx = BLOCK_HEIGHT,
  onOpenEntry,
}: {
  block: WeekBlock;
  band: WeekModel['band'];
  /** Clamped block height — sessions carry no duration, so a block defaults to
   *  `BLOCK_HEIGHT` but is shortened to the gap before the next session in the
   *  same column so closely-timed sessions don't overlap. */
  heightPx?: number;
  onOpenEntry: (entryId: string) => void;
}) {
  const toneSpec = PRODUCER_TONES[block.status];
  const filled = block.meter.filter(s => s.filled).length;
  const top = ((block.startMinutes - band.startMinutes) / 60) * HOUR_HEIGHT;

  return (
    <button
      type="button"
      data-testid={`week-block-${block.entryId}-${block.session}`}
      onClick={() => onOpenEntry(block.entryId)}
      style={{ top, height: heightPx }}
      className="absolute inset-x-1 flex flex-col justify-between overflow-hidden rounded-[6px] border border-border bg-card px-1.5 py-1 text-left shadow-elev1 hover:bg-muted/40"
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', toneSpec.railClass)} />
      <span className="truncate pl-1.5 font-mono text-[10px] text-muted-foreground">
        {minutesToLabel(block.startMinutes)}
      </span>
      <p className="truncate pl-1.5 text-[12px] font-semibold text-foreground">{block.title}</p>
      <p className="truncate pl-1.5 text-[10.5px] text-muted-foreground">
        {[block.venue, block.city].filter(Boolean).join(' · ')}
      </p>
      <div className="flex items-center gap-1.5 pl-1.5">
        <FillMeter segments={block.meter} tone={toneSpec.tone} size="chip" />
        <span className={cn('font-mono text-[10px] font-medium', TONE_TEXT[toneSpec.tone])}>
          {filled}/{block.meter.length}
        </span>
      </div>
    </button>
  );
}

/**
 * Producer Week lens: a time grid built from `toWeekModel(entries, anchor)`
 * (design §4.3). An hour gutter spans `band.startMinutes`..`endMinutes` in
 * whole-hour rows; 7 Mon-Sun day columns sit beside it, the today column
 * tinted. Each timed session renders as a `WeekBlock` absolutely positioned
 * by `(startMinutes - band.startMinutes)` at a fixed block height (session
 * data carries no durations) — multi-session dates stack their blocks in the
 * same column. Dates with every session null ("untimed") render as a chip in
 * an "all day / times TBD" strip above the grid instead of a positioned
 * block. Clicking a block or a chip fires `onOpenEntry`. Full width, no rail
 * (the rail is `DayRail`, composed by the caller/`CalendarSurface`).
 */
export function WeekLens({ entries, anchor, onOpenEntry, today = new Date(), className }: WeekLensProps) {
  // Memoized on its only inputs so a producer's range-select drag (which
  // mutates range state on every mouseenter, but never `entries`/`anchor`)
  // doesn't rebuild the whole time-grid model per cell entered — mirrors the
  // SeasonLens memoization.
  const model = useMemo(() => toWeekModel(entries, anchor), [entries, anchor]);
  const { band } = model;

  const hourMarks: number[] = [];
  for (let m = band.startMinutes; m <= band.endMinutes; m += 60) hourMarks.push(m);
  const totalHeight = ((band.endMinutes - band.startMinutes) / 60) * HOUR_HEIGHT;

  const blocksByColumn = byColumn(model.blocks);
  const untimedByColumn = byColumn(model.untimed);

  return (
    <div data-testid="week-lens" className={cn('flex w-full flex-col', className)}>
      {/* Day header row: weekday + date, today tinted. */}
      <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-border">
        <div />
        {model.columns.map((day, i) => {
          const isToday = isSameDay(day, today);
          const unfilled = model.unfilledByColumn[i] ?? 0;
          return (
            <div
              key={toDateKey(day)}
              data-testid={`week-day-header-${toDateKey(day)}`}
              className={cn('flex flex-col items-center gap-0.5 border-l border-border px-1 py-2', isToday && 'bg-accent-50')}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {WEEKDAYS[i]}
              </span>
              <span className={cn('font-mono text-[17px] tabular-nums', isToday ? 'font-semibold text-primary' : 'text-foreground')}>
                {day.getDate()}
              </span>
              {unfilled > 0 && (
                <span
                  data-testid={`week-day-unfilled-${toDateKey(day)}`}
                  className="font-mono text-[10px] font-semibold leading-none text-warning"
                >
                  &minus;{unfilled}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* "All day / times TBD" strip for untimed dates. */}
      <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-border">
        <div className="px-1 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">TBD</div>
        {model.columns.map((day, i) => (
          <div key={toDateKey(day)} className="flex flex-col gap-1 border-l border-border px-1 py-1.5">
            {(untimedByColumn.get(i) ?? []).map(item => (
              <button
                key={item.entryId}
                type="button"
                data-testid={`week-untimed-${item.entryId}`}
                onClick={() => onOpenEntry(item.entryId)}
                className="truncate rounded-[4px] bg-muted px-1.5 py-0.5 text-left text-[11px] font-medium text-foreground hover:bg-muted/70"
              >
                {item.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Time grid: hour gutter + 7 day columns. */}
      <div className="grid grid-cols-[52px_repeat(7,1fr)]">
        <div className="relative" style={{ height: totalHeight }}>
          {hourMarks.map(m => (
            <span
              key={m}
              data-testid={`week-hour-${m}`}
              style={{ top: ((m - band.startMinutes) / 60) * HOUR_HEIGHT }}
              className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground"
            >
              {minutesToLabel(m)}
            </span>
          ))}
        </div>

        {model.columns.map((day, i) => {
          const isToday = isSameDay(day, today);
          const key = toDateKey(day);
          return (
            <div
              key={key}
              data-testid={`week-column-${key}`}
              data-today={isToday}
              className={cn('relative border-l border-border', isToday && 'bg-accent-50')}
              style={{ height: totalHeight }}
            >
              {hourMarks.map(m => (
                <span
                  key={m}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: ((m - band.startMinutes) / 60) * HOUR_HEIGHT }}
                />
              ))}
              {[...(blocksByColumn.get(i) ?? [])]
                .sort((a, b) => a.startMinutes - b.startMinutes)
                .map((block, bi, sorted) => {
                  const next = sorted[bi + 1];
                  // Clamp height to the gap before the next session so
                  // closely-timed blocks in the same column never overlap.
                  const heightPx = next
                    ? Math.min(BLOCK_HEIGHT, ((next.startMinutes - block.startMinutes) / 60) * HOUR_HEIGHT)
                    : BLOCK_HEIGHT;
                  return (
                    <WeekBlockCard
                      key={`${block.entryId}-${block.session}`}
                      block={block}
                      band={band}
                      heightPx={heightPx}
                      onOpenEntry={onOpenEntry}
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
