import { useEffect, useRef, useState } from 'react';
import { getDay } from 'date-fns';
import type { ProducerDateEntry } from '@/lib/calendar/types';
import { toSeasonModel, seasonKpis, type SeasonCell } from '@/lib/calendar/seasonData';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { SeasonKpis } from './SeasonKpis';

interface SeasonLensProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  readyIds: Set<string>;
  onOpenDate: (dateId: string) => void;
  /** Phase 4 range-select across day columns (drag unit = a day, shared with
   *  the Month lens's `RangeSelection` state — see `CalendarSurface`). A
   *  mousedown on a day column (its header or any cell in that column)
   *  arms the drag; entering a different day column fires `onRangeStart`
   *  (once, with the anchor day) then `onRangeExtend` for each day column
   *  entered; `onRangeCommit` fires on mouseup once a drag was armed. A
   *  plain click on a populated cell with no intervening column change
   *  still fires `onOpenDate` only. */
  rangeKeys?: string[];
  onRangeStart?: (key: string) => void;
  onRangeExtend?: (key: string) => void;
  onRangeCommit?: () => void;
  className?: string;
}

/** Left label column width (px), shared by every grid row so columns line up. */
const LABEL_WIDTH = 176;

/** Monday gridline — a heavier left border marking the start of an ISO week,
 *  so a wide season grid stays readable without a full week-boundary chrome. */
function columnBorder(day: Date): string {
  return getDay(day) === 1 ? 'border-l-2 border-l-foreground/25' : 'border-l border-l-border';
}

/** Buckets a 0..1 `intensity` (filledMain/mainSlots) into one of 4 solid
 *  accent stops — accent numbered stops don't take a Tailwind opacity
 *  modifier, so every stop here is a plain solid class, never `/NN`. The
 *  hottest stop (`accent-700`) needs a fixed light foreground rather than
 *  `text-foreground` to stay legible, mirroring the dashboard stage-chain's
 *  hot-card fix. */
function intensityClasses(intensity: number): { bg: string; text: string } {
  if (intensity >= 0.75) return { bg: 'bg-accent-700', text: 'text-accent-50' };
  if (intensity >= 0.5) return { bg: 'bg-accent-500', text: 'text-accent-50' };
  if (intensity >= 0.25) return { bg: 'bg-accent-300', text: 'text-accent-700' };
  return { bg: 'bg-accent-100', text: 'text-accent-700' };
}

function SeasonCellButton({
  showId,
  cell,
  inRange,
  onOpenDate,
  onColumnMouseDown,
  onColumnMouseEnter,
}: {
  showId: string;
  cell: SeasonCell;
  inRange: boolean;
  onOpenDate: (dateId: string) => void;
  onColumnMouseDown: () => void;
  onColumnMouseEnter: () => void;
}) {
  const key = toDateKey(cell.date);
  const testId = `season-cell-${showId}-${key}`;

  if (cell.dateId == null) {
    return (
      <div
        data-testid={testId}
        data-in-range={inRange}
        aria-hidden="true"
        onMouseDown={onColumnMouseDown}
        onMouseEnter={onColumnMouseEnter}
        className={cn('h-9 bg-transparent', columnBorder(cell.date), inRange && 'bg-accent-50')}
      />
    );
  }

  const { bg, text } = intensityClasses(cell.intensity);

  return (
    <button
      type="button"
      data-testid={testId}
      data-in-range={inRange}
      onClick={() => onOpenDate(cell.dateId as string)}
      onMouseDown={onColumnMouseDown}
      onMouseEnter={onColumnMouseEnter}
      title={`${cell.filledMain}/${cell.mainSlots} main`}
      className={cn(
        'flex h-9 items-center justify-center text-[10px] font-medium tabular-nums',
        columnBorder(cell.date),
        bg,
        text,
        inRange && 'bg-accent-50'
      )}
    >
      {cell.mainSlots > 0 ? `${cell.filledMain}/${cell.mainSlots}` : ''}
    </button>
  );
}

/**
 * Producer Season lens: a program × day heatmap over `toSeasonModel(entries,
 * anchor)` (task 3). One row per show (design's row `label`), a cell per day
 * tinted by `intensity` (4 solid accent stops, `filledMain/mainSlots` shown
 * inside), Monday gridlines running through every row. Below the grid, the
 * "Unfilled slots" load-bar row (`loadByDay.openMainSlots` per day), then the
 * `SeasonKpis` summary. Clicking a populated cell fires `onOpenDate`; empty
 * (no-date) cells are inert. Full width. Phase 4: dragging across day
 * columns (mousedown a column, mouseenter another) drives
 * `onRangeStart`/`onRangeExtend`/`onRangeCommit`, and columns whose day key
 * is in `rangeKeys` render a `bg-accent-50` highlight on the header + every
 * program-row cell. While a drag is active, the grid container gets
 * `select-none` (mirrors `MonthGrid`'s `rangeActive` prop) so the pointer
 * move doesn't also select cell text.
 */
export function SeasonLens({
  entries,
  anchor,
  readyIds,
  onOpenDate,
  rangeKeys = [],
  onRangeStart,
  onRangeExtend,
  onRangeCommit,
  className,
}: SeasonLensProps) {
  const model = toSeasonModel(entries, anchor);
  const kpis = seasonKpis(entries, anchor, readyIds);
  const gridCols = `${LABEL_WIDTH}px repeat(${model.days.length}, minmax(20px, 1fr))`;

  const maxOpen = Math.max(1, ...model.loadByDay.map(d => d.openMainSlots));
  const rangeKeySet = new Set(rangeKeys);

  // Drag-by-day-column state, mirroring MonthGrid's anchor/moved-flag
  // discipline: mousedown arms a pending anchor without firing anything (so
  // a plain click still reaches `onOpenDate`); the first mouseenter into a
  // *different* day column confirms a real drag (`onRangeStart`) and every
  // subsequent distinct column fires `onRangeExtend`. `currentKeyRef` tracks
  // the last column reported so moving between cells within the same
  // column (there are several — one per show row) doesn't re-fire.
  const pendingAnchorRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const currentKeyRef = useRef<string | null>(null);
  // Mirrors `draggingRef` as render-visible state, purely to drive the
  // `select-none` class on the grid container (a ref alone wouldn't
  // re-render) — MonthGrid's `rangeActive` serves the same purpose there.
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (draggingRef.current) {
        onRangeCommit?.();
      }
      pendingAnchorRef.current = null;
      currentKeyRef.current = null;
      draggingRef.current = false;
      setDragging(false);
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [onRangeCommit]);

  const handleColumnMouseDown = (key: string) => {
    pendingAnchorRef.current = key;
    currentKeyRef.current = key;
    draggingRef.current = false;
  };

  const handleColumnMouseEnter = (key: string) => {
    if (pendingAnchorRef.current === null || key === currentKeyRef.current) return;
    currentKeyRef.current = key;
    if (!draggingRef.current) {
      onRangeStart?.(pendingAnchorRef.current);
      draggingRef.current = true;
      setDragging(true);
    }
    onRangeExtend?.(key);
  };

  return (
    <div data-testid="season-lens" className={cn('flex w-full flex-col gap-5', className)}>
      <div
        data-testid="season-grid"
        className={cn('w-full overflow-x-auto rounded-m border border-border bg-card', dragging && 'select-none')}
      >
        {/* Day header row. */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Show
          </div>
          {model.days.map(day => {
            const key = toDateKey(day);
            const inRange = rangeKeySet.has(key);
            return (
              <div
                key={key}
                data-testid={`season-day-${key}`}
                data-in-range={inRange}
                onMouseDown={() => handleColumnMouseDown(key)}
                onMouseEnter={() => handleColumnMouseEnter(key)}
                className={cn(
                  'flex flex-col items-center justify-center py-1 font-mono text-[9px] tabular-nums text-muted-foreground',
                  columnBorder(day),
                  inRange && 'bg-accent-50'
                )}
              >
                {day.getDate()}
              </div>
            );
          })}
        </div>

        {/* One row per show. */}
        {model.rows.map(row => (
          <div
            key={row.showId}
            data-testid={`season-row-${row.showId}`}
            className="grid border-b border-border last:border-b-0"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="truncate px-2 py-2 text-[12px] font-medium text-foreground" title={row.label}>
              {row.label}
            </div>
            {row.cells.map(cell => {
              const key = toDateKey(cell.date);
              return (
                <SeasonCellButton
                  key={key}
                  showId={row.showId}
                  cell={cell}
                  inRange={rangeKeySet.has(key)}
                  onOpenDate={onOpenDate}
                  onColumnMouseDown={() => handleColumnMouseDown(key)}
                  onColumnMouseEnter={() => handleColumnMouseEnter(key)}
                />
              );
            })}
          </div>
        ))}

        {/* "Unfilled slots" load-bar row. */}
        <div className="grid bg-muted/30" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unfilled slots
          </div>
          {model.loadByDay.map(({ date, openMainSlots }) => {
            const pct = (openMainSlots / maxOpen) * 100;
            return (
              <div
                key={toDateKey(date)}
                data-testid={`season-loadbar-${toDateKey(date)}`}
                data-open-main-slots={openMainSlots}
                className={cn('flex h-9 flex-col items-center justify-end gap-0.5 px-0.5 pb-0.5', columnBorder(date))}
              >
                {openMainSlots > 0 && (
                  <span
                    aria-hidden="true"
                    style={{ height: `${Math.max(10, pct)}%` }}
                    className="w-1.5 rounded-t-[2px] bg-warning"
                  />
                )}
                <span className="font-mono text-[8px] tabular-nums text-muted-foreground">{openMainSlots}</span>
              </div>
            );
          })}
        </div>
      </div>

      <SeasonKpis kpis={kpis} />
    </div>
  );
}
