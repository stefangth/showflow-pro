import { format } from 'date-fns';
import { Ticket } from 'lucide-react';
import type { ArtistDateEntry } from '@/lib/calendar/types';
import { ARTIST_TONES } from '@/lib/calendar/tone';
import { isPastDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AllDatesHeader {
  label: string;
  className: string;
}

const HEADERS: AllDatesHeader[] = [
  { label: 'Date', className: 'w-24 shrink-0' },
  { label: 'Day', className: 'w-[42px] shrink-0' },
  { label: 'Show', className: 'min-w-0 flex-1' },
  // "Session" replaces the design's "Call" column — this project doesn't
  // model a separate call time, so it shows the entry's session_1 instead.
  { label: 'Session', className: 'w-[52px] shrink-0' },
  { label: 'My status', className: 'w-[104px] shrink-0' },
  { label: '', className: 'w-[150px] shrink-0' },
];

interface AllDatesLensProps {
  entries: ArtistDateEntry[];
  onBlock: (dateId: string, date: Date) => void;
  hireOrderHref: (id: string) => string;
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
 * a Block-date button (`onBlock`); every other row has no action.
 */
export function AllDatesLens({ entries, onBlock, hireOrderHref, today = new Date(), className }: AllDatesLensProps) {
  return (
    <div
      data-testid="all-dates-lens"
      className={cn(
        'overflow-hidden rounded-l border border-border bg-card shadow-elev1',
        className
      )}
    >
      <div className="flex items-center gap-3.5 border-b border-border bg-muted px-3.5 py-2.5">
        {HEADERS.map((header) => (
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
            className="flex items-center gap-3.5 border-b border-border/60 px-3.5 py-2.5 last:border-b-0 hover:bg-muted/50"
          >
            <span className="w-24 shrink-0 font-mono text-[12.5px] font-medium tabular-nums text-foreground">
              {format(entry.date, 'd MMM')}
            </span>
            <span className="w-[42px] shrink-0 text-xs text-muted-foreground">{format(entry.date, 'EEE')}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-foreground">
                {entry.program}
                {entry.subProgram ? ` · ${entry.subProgram}` : ''}
              </p>
              {entry.venue && <p className="truncate text-xs text-muted-foreground">{entry.venue}</p>}
            </div>
            <span className="w-[52px] shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {entry.session1 ?? ''}
            </span>
            <span
              className={cn(
                'inline-flex h-5 w-[104px] shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 text-[11px] font-medium',
                toneSpec.badgeClass
              )}
            >
              {toneSpec.label}
            </span>
            <div className="flex w-[150px] shrink-0 justify-end">
              {showLink && (
                <a
                  href={hireOrderHref(entry.hireOrderId!)}
                  data-testid={`all-dates-link-${entry.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Ticket className="h-3 w-3" />
                  Hire order
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
                  Block date
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
