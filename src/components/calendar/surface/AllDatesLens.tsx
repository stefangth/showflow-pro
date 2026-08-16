import { format } from 'date-fns';
import { Ticket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ArtistDateEntry, ArtistStatus } from '@/lib/calendar/types';
import { ARTIST_TONES, artistStatusLabel } from '@/lib/calendar/tone';
import { isPastDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AllDatesHeader {
  label: string;
  className: string;
}

interface AllDatesLensProps {
  entries: ArtistDateEntry[];
  onBlock: (dateId: string, date: Date) => void;
  hireOrderHref: (id: string) => string;
  /** Flow-aware artist status label override (see `artistStatusLabel`). */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Override for "today", so tests get a deterministic future/past split. */
  today?: Date;
  className?: string;
}

/**
 * Artist All dates lens: the full-history table (design lines 550-595) —
 * every eligible date, one row each, with Date/Day/Show·venue/Session
 * ("Call" is renamed to "Session" for this project: there is no separate
 * call-time field, so it shows `session1`)/My status/action columns. The
 * trailing action column is row-specific: a confirmed date with an issued
 * hire order links to it (`hireOrderHref`); an unanswered future date gets
 * a Block-date button (`onBlock`); every other row has no action. Rows
 * reflow to stacked cards below the `md:` breakpoint (768px, matching
 * `useIsMobile`) via responsive classes — the fixed-column header hides
 * entirely (a table header reads oddly once the columns stack), the
 * Date/Day pair collapses via `md:contents` so it restores the exact
 * desktop flex items at `md:`, and every other cell drops its fixed pixel
 * width until `md:` so nothing acts like a table column on a phone. The
 * caller decides what a row's action means; this component just renders
 * (see `CalendarSurface`, which uses the same `AllDatesLens` for both the
 * desktop and mobile branches).
 */
export function AllDatesLens({ entries, onBlock, hireOrderHref, statusLabels, today = new Date(), className }: AllDatesLensProps) {
  const { t } = useTranslation('availability');

  const headers: AllDatesHeader[] = [
    { label: t('calendar.allDates.headerDate'), className: 'w-24 shrink-0' },
    { label: t('calendar.allDates.headerDay'), className: 'w-[42px] shrink-0' },
    { label: t('calendar.allDates.headerShow'), className: 'min-w-0 flex-1' },
    // "Session" replaces the design's "Call" column — this project doesn't
    // model a separate call time, so it shows the entry's session_1 instead.
    { label: t('calendar.allDates.headerSession'), className: 'w-[52px] shrink-0' },
    { label: t('calendar.allDates.headerMyStatus'), className: 'w-[104px] shrink-0' },
    { label: '', className: 'w-[150px] shrink-0' },
  ];

  return (
    <div
      data-testid="all-dates-lens"
      className={cn(
        'overflow-hidden rounded-l border border-border bg-card shadow-elev1',
        className
      )}
    >
      <div className="hidden items-center gap-3.5 border-b border-border bg-muted px-3.5 py-2.5 md:flex">
        {headers.map((header) => (
          <span
            key={header.label || 'action'}
            className={cn(
              'shrink-0 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground',
              header.className
            )}
          >
            {header.label}
          </span>
        ))}
      </div>

      {entries.map((entry) => {
        const toneSpec = ARTIST_TONES[entry.myStatus];
        const showLink = entry.myStatus === 'confirmed' && !!entry.hireOrderId;
        const showBlock = entry.myStatus === 'unanswered' && !isPastDate(entry.date, today);

        return (
          <div
            key={entry.id}
            data-testid={`all-dates-row-${entry.id}`}
            // Mobile-first: rows stack single-column (spec §5); `md:`
            // restores the desktop single-line row exactly at >=768px
            // (matching `useIsMobile`'s breakpoint) — every `md:`-only
            // utility below reproduces a value this row already had.
            className="flex flex-col items-start gap-2 border-b border-border/60 px-3.5 py-3 last:border-b-0 hover:bg-muted/50 md:flex-row md:items-center md:gap-3.5 md:py-2.5"
          >
            <div className="flex items-center gap-2 md:contents">
              <span className="font-mono text-[12.5px] font-medium tabular-nums text-foreground md:w-24 md:shrink-0">
                {format(entry.date, 'd MMM')}
              </span>
              <span className="text-xs text-muted-foreground md:w-[42px] md:shrink-0">{format(entry.date, 'EEE')}</span>
            </div>
            <div className="min-w-0 w-full md:flex-1">
              <p className="truncate text-[13.5px] font-semibold text-foreground">
                {entry.program}
                {entry.subProgram ? ` · ${entry.subProgram}` : ''}
              </p>
              {entry.venue && <p className="truncate text-xs text-muted-foreground">{entry.venue}</p>}
            </div>
            <span className="font-mono text-xs tabular-nums text-muted-foreground md:w-[52px] md:shrink-0">
              {entry.session1 ?? ''}
            </span>
            <span
              className={cn(
                'inline-flex h-5 items-center whitespace-nowrap rounded-xs px-1.5 text-[11px] font-medium md:w-[104px] md:shrink-0',
                toneSpec.badgeClass
              )}
            >
              {artistStatusLabel(entry.myStatus, statusLabels)}
            </span>
            <div className="flex w-full justify-start md:w-[150px] md:shrink-0 md:justify-end">
              {showLink && (
                <a
                  href={hireOrderHref(entry.hireOrderId!)}
                  data-testid={`all-dates-link-${entry.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Ticket className="h-3 w-3" />
                  {t('calendar.allDates.hireOrder')}
                </a>
              )}
              {showBlock && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`all-dates-block-${entry.id}`}
                  onClick={() => onBlock(entry.id, entry.date)}
                >
                  {t('calendar.shared.blockDate')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
