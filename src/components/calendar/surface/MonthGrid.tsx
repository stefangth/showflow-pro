import type { KeyboardEvent } from 'react';
import type { MonthGridCell } from '@/lib/calendar/types';
import { TONE_FILL, TONE_TEXT } from '@/lib/calendar/tone';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { FillMeter } from './FillMeter';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface MonthGridProps {
  cells: MonthGridCell[];
  onSelectDay: (day: Date) => void;
  onOpenDay: (day: Date) => void;
  onRangeExtend?: (key: string) => void;
  className?: string;
}

/**
 * Shared, presentational 7-col month grid. Cells arrive pre-ordered
 * (Monday-first, always 42) from `monthMatrix`/the caller's cell builder —
 * this component only renders them and reports interaction back up.
 */
export function MonthGrid({ cells, onSelectDay, onOpenDay, onRangeExtend, className }: MonthGridProps) {
  const handleSelect = (cell: MonthGridCell) => {
    if (!cell.day) return;
    onSelectDay(cell.day);
    onRangeExtend?.(toDateKey(cell.day));
  };

  const handleOpen = (cell: MonthGridCell) => {
    if (!cell.day) return;
    onOpenDay(cell.day);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, cell: MonthGridCell) => {
    if (!cell.day) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      handleOpen(cell);
    } else if (event.key === ' ') {
      // Space = select for now; peek is deferred to Phase 4.
      event.preventDefault();
      handleSelect(cell);
    }
  };

  return (
    <div className={cn('w-full', className)} data-testid="month-grid">
      <div className="grid grid-cols-7 border-b border-border pb-1.5">
        {WEEKDAYS.map(day => (
          <div
            key={day}
            data-testid="month-grid-weekday"
            className="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-border">
        {cells.map((cell, i) => {
          if (!cell.day) {
            return <div key={i} className="min-h-[104px] bg-muted/30" data-testid="month-grid-cell-empty" />;
          }

          const key = toDateKey(cell.day);
          const visibleChips = cell.chips.slice(0, 2);

          return (
            <div
              key={key}
              data-testid={`month-grid-cell-${key}`}
              data-today={cell.isToday}
              data-selected={cell.isSelected}
              data-in-range={cell.inRange}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(cell)}
              onDoubleClick={() => handleOpen(cell)}
              onKeyDown={e => handleKeyDown(e, cell)}
              className={cn(
                'flex min-h-[104px] flex-col gap-1 bg-background p-1.5 text-left outline-none transition-colors',
                'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                cell.isPast && 'opacity-60',
                cell.inRange && 'bg-accent-50',
                cell.isSelected && 'ring-2 ring-inset ring-primary'
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'font-mono text-xs tabular-nums',
                    cell.isToday
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      : 'text-foreground'
                  )}
                  data-testid={cell.isToday ? 'month-grid-today-marker' : undefined}
                >
                  {cell.dayNum}
                </span>
                {cell.flag && (
                  <span className={cn('text-[11px] font-medium', TONE_TEXT[cell.flag.tone])}>
                    {cell.flag.text}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {visibleChips.map((chip, chipIndex) => (
                  <div
                    key={chipIndex}
                    className="flex items-stretch gap-1 rounded-[4px] bg-muted/40 py-0.5 pr-1 text-[11px]"
                  >
                    <span className={cn('w-0.5 shrink-0 rounded-full', TONE_FILL[chip.tone])} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate font-medium', TONE_TEXT[chip.tone])}>{chip.title}</div>
                      {chip.time && <div className="text-muted-foreground">{chip.time}</div>}
                      {chip.meter && <FillMeter segments={chip.meter} tone={chip.tone} className="mt-0.5" />}
                    </div>
                  </div>
                ))}
                {cell.moreCount > 0 && (
                  <span className="text-[11px] text-muted-foreground">+{cell.moreCount} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
