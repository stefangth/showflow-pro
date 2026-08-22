import { format, isToday } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { ProducerDateEntry } from '@/lib/calendar/types';
import { toSeasonModel, type SeasonCell } from '@/lib/calendar/seasonData';
import { unconfirmedSlots } from '@/lib/calendar/slots';
import { seasonBarClass } from '@/lib/calendar/tone';
import { dfLocale, toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';

export interface SeasonStripMobileProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  readyIds: Set<string>;
  onOpenDate: (dateId: string) => void;
  className?: string;
}

/** Frozen label column width (px) and per-day column width (px), shared by
 *  every row (header / program rows / load-bar row) so columns line up —
 *  mirrors `SeasonLens`'s `LABEL_WIDTH` constant, sized down for a phone
 *  viewport (mock 2e). */
const LABEL_WIDTH = 92;
const DAY_WIDTH = 20;
/** Bar track height (px) for the per-program fill-height bars. Height is
 *  `Math.max(12, Math.round(42 * Math.max(intensity, 0.25)))` — the fill ratio
 *  floored at 25% so a configured-but-empty date still shows a visible stub. */
const BAR_TRACK_HEIGHT = 42;
/** A day's "Unfilled slots" load bar renders amber once it is at least half
 *  of the window's busiest day, muted otherwise. */
const HEAVY_LOAD_PCT = 50;

function barHeightPx(intensity: number): number {
  return Math.max(12, Math.round(BAR_TRACK_HEIGHT * Math.max(intensity, 0.25)));
}

function SeasonStripCell({
  showId,
  cell,
  ready,
  onOpenDate,
}: {
  showId: string;
  cell: SeasonCell;
  ready: boolean;
  onOpenDate: (dateId: string) => void;
}) {
  const { t } = useTranslation('bookings');
  const key = toDateKey(cell.date);
  const testId = `season-strip-cell-${showId}-${key}`;

  if (cell.dateId == null) {
    return (
      <div
        data-testid={testId}
        aria-hidden="true"
        className="flex h-[54px] items-end justify-center border-l border-l-border"
      />
    );
  }

  const cancelled = cell.status === 'cancelled';

  return (
    <button
      type="button"
      data-testid={testId}
      data-ready={ready}
      data-status={cell.status ?? 'open'}
      onClick={() => onOpenDate(cell.dateId as string)}
      title={t('calendar.seasonStripMobile.cellTooltip', { filled: cell.filledMain, total: cell.mainSlots })}
      className={cn('flex h-[54px] justify-center border-l border-l-border py-0.5', cancelled ? 'items-center' : 'items-end')}
    >
      {cancelled ? (
        <span aria-hidden="true" className="font-mono text-eyebrow font-semibold leading-none text-destructive">
          &times;
        </span>
      ) : cell.mainSlots > 0 ? (
        <span
          aria-hidden="true"
          style={{ height: `${barHeightPx(cell.intensity)}px` }}
          className={cn('w-2.5 rounded-t-[2px]', seasonBarClass(cell.status), ready && 'ring-1 ring-accent-700')}
        />
      ) : null}
    </button>
  );
}

/**
 * Mobile Season strip (mock 2e): the desktop `SeasonLens` program×day
 * heatmap, condensed for a phone viewport. A frozen ~92px left label column
 * (`sticky left-0 z-10`, one row per show plus an "Open" footer row) sits
 * beside a horizontally-scrolling day grid built from
 * `toSeasonModel(entries, anchor)` (Phase 3) — a today-tinted date header,
 * per-program fill-height bars coloured by date *status* (via the shared
 * `seasonBarClass`, matching the desktop `SeasonLens`; a cancelled date
 * shows a destructive "x"), and a bottom "Unfilled slots" load-bar row that
 * turns amber once a day is at least half as loaded as the window's busiest
 * day. The label column and the day grid live in one `overflow-x-auto`
 * scroll region so the scroll never escapes the strip onto the page body.
 * Tapping a populated cell fires `onOpenDate`; empty (no-date) cells are
 * inert. `readyIds` (dates ready for a hire order) rings the matching cell's
 * bar, mirroring the desktop KPI's "ready for hire order" signal without
 * needing the 3-tile `SeasonKpis` card this narrow a viewport has no room
 * for.
 */
export function SeasonStripMobile({ entries, anchor, readyIds, onOpenDate, className }: SeasonStripMobileProps) {
  const { t } = useTranslation('bookings');
  const model = toSeasonModel(entries, anchor);
  const gridCols = `${LABEL_WIDTH}px repeat(${model.days.length}, ${DAY_WIDTH}px)`;
  const maxOpen = Math.max(1, ...model.loadByDay.map(d => d.openMainSlots));

  return (
    <div data-testid="season-strip-mobile" className={cn('flex w-full flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between px-1">
        <p className="text-sm font-semibold text-foreground">
          {t('calendar.seasonStripMobile.heading', { month: format(anchor, 'MMM yyyy', { locale: dfLocale() }) })}
        </p>
        <p className="text-eyebrow text-muted-foreground">{t('calendar.seasonStripMobile.swipeHint')}</p>
      </div>

      <div
        data-testid="season-strip-scroll"
        className="w-full overflow-x-auto rounded-m border border-border bg-card"
      >
        {/* Date header row. */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: gridCols }}>
          <div
            data-testid="season-strip-corner"
            // eslint-disable-next-line no-restricted-syntax -- needs a data-testid, which <Eyebrow> (no pass-through props) can't carry
            className="sticky left-0 z-10 truncate bg-card px-2 py-1.5 text-eyebrow font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('calendar.seasonStripMobile.cornerLabel')}
          </div>
          {model.days.map(day => {
            const key = toDateKey(day);
            const today = isToday(day);
            return (
              <div
                key={key}
                data-testid={`season-strip-day-${key}`}
                data-today={today}
                className={cn(
                  'flex items-center justify-center border-l border-l-border py-1 font-mono text-eyebrow tabular-nums text-muted-foreground',
                  today && 'bg-accent-tint text-accent-text'
                )}
              >
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
              data-testid={`season-strip-row-${row.showId}`}
              className="grid border-b border-border last:border-b-0"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div
                data-testid={`season-strip-label-${row.showId}`}
                title={rowLabel}
                className="sticky left-0 z-10 flex flex-col justify-center gap-0.5 truncate bg-card px-2 py-1.5"
              >
                <span className="truncate text-eyebrow font-medium text-foreground">
                  {rowLabel}
                </span>
                <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
                  {t('calendar.seasonStripMobile.rowSummary', { count: dateCount, unfilled })}
                </span>
              </div>
              {row.cells.map(cell => (
                <SeasonStripCell
                  key={toDateKey(cell.date)}
                  showId={row.showId}
                  cell={cell}
                  ready={cell.dateId != null && readyIds.has(cell.dateId)}
                  onOpenDate={onOpenDate}
                />
              ))}
            </div>
          );
        })}

        {/* "Open" footer row — the load-bar row's frozen label. */}
        <div data-testid="season-strip-loadbar-row" className="grid bg-well-tint" style={{ gridTemplateColumns: gridCols }}>
          <div
            data-testid="season-strip-label-open"
            // eslint-disable-next-line no-restricted-syntax -- needs a data-testid, which <Eyebrow> (no pass-through props) can't carry
            className="sticky left-0 z-10 flex items-center bg-well-tint px-2 py-1.5 text-eyebrow font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('calendar.seasonStripMobile.openFooterLabel')}
          </div>
          {model.loadByDay.map(({ date, openMainSlots }) => {
            const pct = (openMainSlots / maxOpen) * 100;
            const heavy = pct >= HEAVY_LOAD_PCT;
            return (
              <div
                key={toDateKey(date)}
                data-testid={`season-strip-loadbar-${toDateKey(date)}`}
                data-open-main-slots={openMainSlots}
                className="flex h-8 flex-col items-center justify-end gap-0.5 border-l border-l-border px-0.5 pb-0.5"
              >
                {openMainSlots > 0 && (
                  <span
                    aria-hidden="true"
                    style={{ height: `${Math.max(10, pct)}%` }}
                    className={cn('w-1.5 rounded-t-[2px]', heavy ? 'bg-warning' : 'bg-muted-foreground/40')}
                  />
                )}
                <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">{openMainSlots}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
