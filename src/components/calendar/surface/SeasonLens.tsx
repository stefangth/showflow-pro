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
  /** Phase 4 range-select across day columns — accepted, inert here. */
  rangeKeys?: string[];
  onRangeExtend?: (key: string) => void;
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
  onOpenDate,
}: {
  showId: string;
  cell: SeasonCell;
  onOpenDate: (dateId: string) => void;
}) {
  const key = toDateKey(cell.date);
  const testId = `season-cell-${showId}-${key}`;

  if (cell.dateId == null) {
    return (
      <div
        data-testid={testId}
        aria-hidden="true"
        className={cn('h-9 bg-transparent', columnBorder(cell.date))}
      />
    );
  }

  const { bg, text } = intensityClasses(cell.intensity);

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onOpenDate(cell.dateId as string)}
      title={`${cell.filledMain}/${cell.mainSlots} main`}
      className={cn(
        'flex h-9 items-center justify-center text-[10px] font-medium tabular-nums',
        columnBorder(cell.date),
        bg,
        text
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
 * (no-date) cells are inert. Full width. `rangeKeys`/`onRangeExtend` are
 * accepted but unused here — Phase 4 wires drag range-select across columns.
 */
export function SeasonLens({ entries, anchor, readyIds, onOpenDate, className }: SeasonLensProps) {
  const model = toSeasonModel(entries, anchor);
  const kpis = seasonKpis(entries, anchor, readyIds);
  const gridCols = `${LABEL_WIDTH}px repeat(${model.days.length}, minmax(20px, 1fr))`;

  const maxOpen = Math.max(1, ...model.loadByDay.map(d => d.openMainSlots));

  return (
    <div data-testid="season-lens" className={cn('flex w-full flex-col gap-5', className)}>
      <div className="w-full overflow-x-auto rounded-m border border-border bg-card">
        {/* Day header row. */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Show
          </div>
          {model.days.map(day => (
            <div
              key={toDateKey(day)}
              data-testid={`season-day-${toDateKey(day)}`}
              className={cn(
                'flex flex-col items-center justify-center py-1 font-mono text-[9px] tabular-nums text-muted-foreground',
                columnBorder(day)
              )}
            >
              {day.getDate()}
            </div>
          ))}
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
            {row.cells.map(cell => (
              <SeasonCellButton key={toDateKey(cell.date)} showId={row.showId} cell={cell} onOpenDate={onOpenDate} />
            ))}
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
