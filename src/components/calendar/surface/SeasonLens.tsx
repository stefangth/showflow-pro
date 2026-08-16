import { useEffect, useMemo, useRef, useState } from 'react';
import { getDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { ProducerDateEntry } from '@/lib/calendar/types';
import { toSeasonModel, seasonKpis, type SeasonCell } from '@/lib/calendar/seasonData';
import { unconfirmedSlots } from '@/lib/calendar/slots';
import { seasonBarClass } from '@/lib/calendar/tone';
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
const LABEL_WIDTH = 208;

/** Single-letter weekday initials (Sun..Sat, indexed by `getDay()`), shown
 *  above each date number in the day header — weekend columns render greyed. */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A day's "Unfilled slots" load bar renders in saturated warning once it
 *  carries this many open main slots, a lighter tint below it (mock). */
const HEAVY_LOAD_SLOTS = 5;

/** Monday gridline — a heavier left border marking the start of an ISO week,
 *  so a wide season grid stays readable without a full week-boundary chrome. */
function columnBorder(day: Date): string {
  return getDay(day) === 1 ? 'border-l-2 border-l-foreground/25' : 'border-l border-l-border';
}

/** Cell bar track (px) inside the 52px row and its minimum drawn height, so an
 *  all-but-empty date still shows a visible stub. Height is proportional to
 *  the fill ratio (floored at 25% so a 0-filled but configured date reads as
 *  "open, nothing yet" rather than invisible). */
const BAR_TRACK = 34;
const BAR_MIN = 14;

function barHeightPx(intensity: number): number {
  return Math.max(BAR_MIN, Math.round(BAR_TRACK * Math.max(intensity, 0.25)));
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
  const { t } = useTranslation('bookings');
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
        className={cn('h-[52px] bg-transparent', columnBorder(cell.date), inRange && 'bg-accent-50')}
      />
    );
  }

  // Status-tone encoding (mock): a bottom-anchored bar coloured by *status*
  // (fully→success, casting→warning, open→muted), its height showing fill;
  // a cancelled date shows a destructive "x" instead of a bar.
  const cancelled = cell.status === 'cancelled';
  const toneLabel = cell.status ? t(`calendar.producerStatus.${cell.status}`) : t('calendar.season.openStatusFallback');

  return (
    <button
      type="button"
      data-testid={testId}
      data-in-range={inRange}
      data-status={cell.status ?? 'open'}
      onClick={() => onOpenDate(cell.dateId as string)}
      onMouseDown={onColumnMouseDown}
      onMouseEnter={onColumnMouseEnter}
      title={t('calendar.season.cellTooltip', { filled: cell.filledMain, total: cell.mainSlots, status: toneLabel })}
      className={cn(
        'flex h-[52px] items-end justify-center px-0.5 pb-1',
        columnBorder(cell.date),
        inRange && 'bg-accent-50'
      )}
    >
      {cancelled ? (
        <span aria-hidden="true" className="mb-1.5 font-mono text-[11px] font-semibold leading-none text-destructive">
          &times;
        </span>
      ) : cell.mainSlots > 0 ? (
        <span
          aria-hidden="true"
          style={{ height: `${barHeightPx(cell.intensity)}px` }}
          className={cn('w-2.5 rounded-t-[2px]', seasonBarClass(cell.status))}
        />
      ) : null}
    </button>
  );
}

/**
 * Producer Season lens: a program × day heatmap over `toSeasonModel(entries,
 * anchor)` (task 3). One row per show (design's row `label`), a cell per day
 * showing a bottom-anchored bar whose colour is the date's *status* (via
 * `seasonBarClass`: fully→success, casting→warning, open→muted) and whose
 * height tracks the fill ratio, a cancelled date showing a destructive "x";
 * Monday gridlines running through every row. Below the grid, the
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
  const { t } = useTranslation('bookings');
  // Memoized so a producer's range-select drag (which updates `rangeKeys` on
  // every mouseenter) doesn't rebuild the whole 3-month grid + KPIs each move.
  const model = useMemo(() => toSeasonModel(entries, anchor), [entries, anchor]);
  const kpis = useMemo(() => seasonKpis(entries, anchor, readyIds), [entries, anchor, readyIds]);
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
            {t('calendar.season.programHeader')}
          </div>
          {model.days.map(day => {
            const key = toDateKey(day);
            const inRange = rangeKeySet.has(key);
            const dow = getDay(day);
            const isWeekend = dow === 0 || dow === 6;
            return (
              <div
                key={key}
                data-testid={`season-day-${key}`}
                data-in-range={inRange}
                onMouseDown={() => handleColumnMouseDown(key)}
                onMouseEnter={() => handleColumnMouseEnter(key)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-1 font-mono text-[9px] tabular-nums text-muted-foreground',
                  columnBorder(day),
                  inRange && 'bg-accent-50'
                )}
              >
                <span className={cn('text-[8px] font-sans not-italic', isWeekend ? 'text-muted-foreground/50' : 'text-muted-foreground/80')}>
                  {WEEKDAY_INITIALS[dow]}
                </span>
                {day.getDate()}
              </div>
            );
          })}
        </div>

        {/* One row per show. */}
        {model.rows.map(row => {
          const populated = row.cells.filter(cell => cell.dateId != null);
          const dateCount = populated.length;
          const unfilled = populated.reduce((sum, cell) => sum + unconfirmedSlots({ mainSlots: cell.mainSlots, confirmedMain: cell.filledMain }), 0);
          const rowLabel = row.label || t('calendar.season.untitled');
          return (
          <div
            key={row.showId}
            data-testid={`season-row-${row.showId}`}
            className="grid border-b border-border last:border-b-0"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="flex flex-col justify-center gap-0.5 truncate px-2 py-2" title={rowLabel}>
              <span className="truncate text-[12px] font-medium text-foreground">{rowLabel}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {t('calendar.season.rowSummary', { count: dateCount, unfilled })}
              </span>
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
          );
        })}

        {/* "Unfilled slots" load-bar row. */}
        <div className="grid bg-muted/30" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendar.season.unfilledSlotsHeader')}
          </div>
          {model.loadByDay.map(({ date, openMainSlots }) => {
            const pct = (openMainSlots / maxOpen) * 100;
            // Two-tier load colour (mock): saturated warning once a day carries
            // 5+ open main slots, a lighter warning tint for anything above zero.
            const heavy = openMainSlots >= HEAVY_LOAD_SLOTS;
            return (
              <div
                key={toDateKey(date)}
                data-testid={`season-loadbar-${toDateKey(date)}`}
                data-open-main-slots={openMainSlots}
                className={cn('flex h-9 flex-col items-center justify-end px-0.5 pb-0.5', columnBorder(date))}
              >
                {openMainSlots > 0 && (
                  <span
                    aria-hidden="true"
                    style={{ height: `${Math.max(10, pct)}%` }}
                    className={cn('w-1.5 rounded-t-[2px]', heavy ? 'bg-warning' : 'bg-warning/40')}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SeasonKpis kpis={kpis} />
    </div>
  );
}
