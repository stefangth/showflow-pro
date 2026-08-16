import { useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonthGridCell, Tone } from '@/lib/calendar/types';
import { TONE_BG, TONE_TEXT } from '@/lib/calendar/tone';
import { toDateKey, weekdayShortLabels } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { FillMeter } from './FillMeter';

/** Chip left-rail border color per tone — the flush `border-l-2` on the chip
 *  box (design lines 286-296), mirroring `TONE_FILL`'s bg tint. */
const TONE_RAIL: Record<Tone, string> = {
  success: 'border-success',
  warning: 'border-warning',
  muted: 'border-muted-foreground',
  destructive: 'border-destructive',
  accent: 'border-primary',
};

interface MonthGridProps {
  cells: MonthGridCell[];
  onSelectDay: (day: Date) => void;
  onOpenDay: (day: Date) => void;
  /** Fired on Space when provided; falls back to `onSelectDay` otherwise. */
  onPeekDay?: (day: Date) => void;
  onRangeStart?: (key: string) => void;
  onRangeExtend?: (key: string) => void;
  onRangeCommit?: () => void;
  /** True while a selection exists (enables drag visuals, e.g. suppressing
   *  text selection while the pointer is dragging across cells). */
  rangeActive?: boolean;
  /** Mobile "status-bar per day" variant: compact cell min-height, tighter
   *  padding, and a single visible chip per cell (any second chip is folded
   *  into the `moreCount` overflow badge instead of being dropped). Desktop
   *  behavior (the default) is unchanged when this is false/absent. */
  dense?: boolean;
  className?: string;
}

/**
 * Shared, presentational 7-col month grid. Cells arrive pre-ordered
 * (Monday-first, always 42) from `monthMatrix`/the caller's cell builder —
 * this component only renders them and reports interaction back up.
 */
export function MonthGrid({
  cells,
  onSelectDay,
  onOpenDay,
  onPeekDay,
  onRangeStart,
  onRangeExtend,
  onRangeCommit,
  rangeActive,
  dense,
  className,
}: MonthGridProps) {
  const { t } = useTranslation(['common', 'availability']);
  const weekdays = weekdayShortLabels();
  // Anchor cell captured on mousedown, held provisionally until movement
  // confirms this is a real drag (not a plain click). `dragging` only
  // flips true once a *different* cell reports mouseenter — that is what
  // lets a mousedown+mouseup on the same cell with no mouseenter elsewhere
  // fall through to a plain click (onSelectDay) instead of firing a
  // 1-cell range (onRangeStart + onRangeCommit with no onRangeExtend).
  const pendingAnchorRef = useRef<string | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (draggingRef.current) {
        onRangeCommit?.();
      }
      pendingAnchorRef.current = null;
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [onRangeCommit]);

  const handleSelect = (cell: MonthGridCell, event: ReactMouseEvent<HTMLDivElement>) => {
    if (!cell.day) return;
    // A shift-click's mousedown already extended the range (see
    // `handleMouseDown`) — its accompanying click must not also relocate
    // `selectedDay`, or a shift-click would both extend the range AND move
    // the single-day selection.
    if (event.shiftKey) return;
    onSelectDay(cell.day);
  };

  const handleOpen = (cell: MonthGridCell) => {
    if (!cell.day) return;
    onOpenDay(cell.day);
  };

  const handleMouseDown = (cell: MonthGridCell, event: ReactMouseEvent<HTMLDivElement>) => {
    if (!cell.day) return;
    const key = toDateKey(cell.day);
    if (event.shiftKey) {
      // Extend the caller's existing anchor to this cell — no new drag.
      onRangeExtend?.(key);
      return;
    }
    pendingAnchorRef.current = key;
    draggingRef.current = false;
  };

  const handleMouseEnter = (cell: MonthGridCell) => {
    if (!cell.day || pendingAnchorRef.current === null) return;
    const key = toDateKey(cell.day);
    if (!draggingRef.current) {
      // First movement since mousedown — this is now a genuine drag.
      onRangeStart?.(pendingAnchorRef.current);
      draggingRef.current = true;
    }
    onRangeExtend?.(key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, cell: MonthGridCell) => {
    if (!cell.day) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      handleOpen(cell);
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      (onPeekDay ?? onSelectDay)(cell.day);
    }
  };

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card shadow-elev2',
        className
      )}
      data-testid="month-grid"
    >
      <div className="grid grid-cols-7 border-b-[0.5px] border-border pb-1.5">
        {weekdays.map(day => (
          <div
            key={day}
            data-testid="month-grid-weekday"
            className="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-border">
        {cells.map((cell, i) => {
          if (!cell.day) {
            return (
              <div
                key={i}
                className={cn('bg-muted/30', dense ? 'min-h-[62px]' : 'min-h-[104px]')}
                data-testid="month-grid-cell-empty"
              />
            );
          }

          const key = toDateKey(cell.day);
          // `cell.chips` arrives UNCAPPED from the producers (producerData.ts /
          // artistData.ts map every day entry to a chip); the overflow badge is
          // derived here from the visible cap, not added to `cell.moreCount` —
          // that field is itself `Math.max(0, dayEntries.length - 2)` off the
          // same uncapped array, so summing the two would double-count.
          const chipCap = dense ? 1 : 2;
          const visibleChips = cell.chips.slice(0, chipCap);
          const moreCount = Math.max(0, cell.chips.length - chipCap);

          return (
            <div
              key={key}
              data-testid={`month-grid-cell-${key}`}
              data-today={cell.isToday}
              data-selected={cell.isSelected}
              data-in-range={cell.inRange}
              role="button"
              tabIndex={0}
              onClick={e => handleSelect(cell, e)}
              onDoubleClick={() => handleOpen(cell)}
              onMouseDown={e => handleMouseDown(cell, e)}
              onMouseEnter={() => handleMouseEnter(cell)}
              onKeyDown={e => handleKeyDown(e, cell)}
              className={cn(
                'relative flex flex-col gap-1 bg-card text-left outline-none transition-colors',
                dense ? 'min-h-[62px] p-1' : 'min-h-[104px] p-1.5',
                'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                cell.isPast && !cell.isSelected && !cell.inRange && 'bg-muted',
                (cell.inRange || cell.isSelected) && 'bg-accent-50',
                cell.isSelected && 'ring-2 ring-inset ring-primary',
                rangeActive && 'select-none'
              )}
            >
              {cell.isToday && (
                <span
                  data-testid="month-grid-today-marker"
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-primary"
                />
              )}

              <div className="flex items-center justify-between">
                <span className={cn('font-mono text-xs tabular-nums text-foreground', cell.isToday && 'font-semibold')}>
                  {cell.dayNum}
                </span>
                {cell.flag && (
                  <span className={cn('text-[11px] font-medium', TONE_TEXT[cell.flag.tone])}>
                    {cell.flag.text === 'answer' || cell.flag.text === 'blocked'
                      ? t(`availability:calendar.monthFlag.${cell.flag.text}`)
                      : cell.flag.text}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {visibleChips.map((chip, chipIndex) => (
                  <div
                    key={chipIndex}
                    data-testid={`month-grid-chip-${key}-${chipIndex}`}
                    className={cn(
                      'rounded-[4px] border-l-2 py-0.5 pl-1.5 pr-1 text-[11px]',
                      TONE_RAIL[chip.tone],
                      TONE_BG[chip.tone]
                    )}
                  >
                    <div className={cn('truncate font-semibold', TONE_TEXT[chip.tone])}>{chip.title}</div>
                    {(chip.time || chip.meter || (chip.extraSessions ?? 0) > 0) && (
                      <div
                        data-testid={`month-grid-chip-meter-row-${key}-${chipIndex}`}
                        className="mt-0.5 flex items-center gap-1"
                      >
                        {chip.time && (
                          <span className={cn('font-mono text-[9.5px] opacity-80', TONE_TEXT[chip.tone])}>{chip.time}</span>
                        )}
                        {(chip.extraSessions ?? 0) > 0 && (
                          <span
                            data-testid={`month-grid-chip-sessions-${key}-${chipIndex}`}
                            className="inline-flex items-center rounded-[4px] bg-accent-50 px-1 text-[9px] font-medium text-accent-700"
                          >
                            +{chip.extraSessions}
                          </span>
                        )}
                        {chip.meter && (
                          <FillMeter segments={chip.meter} tone={chip.tone} size="chip" className="ml-auto" />
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {moreCount > 0 && (
                  <span className="text-[11px] font-medium text-accent-700">{t('common:calendar.grid.more', { count: moreCount })}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
