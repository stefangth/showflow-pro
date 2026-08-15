import type { NeedsYouGroupKey, NeedsYouQueue } from '@/lib/calendar/needsYou';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface QueueShortlistArtist {
  artistId: string;
  name: string;
}

interface QueueRailShortlist {
  dateId: string;
  dateLabel: string;
  artists: QueueShortlistArtist[];
}

interface QueueRailProps {
  queue: NeedsYouQueue;
  /** Items already resolved today (a receipts count kept in page state) —
   *  the numerator of the "Clear the queue" progress bar. */
  clearedToday: number;
  /** Eligible-artist shortlist for the queue's top at-risk date. `null`
   *  when there's nothing to shortlist (empty queue, or the caller hasn't
   *  resolved eligibility for the top date yet) — the shortlist card is
   *  omitted entirely in that case. */
  shortlist: QueueRailShortlist | null;
  onOffer?: (dateId: string, artistId: string) => void;
  className?: string;
}

/** Canonical display order for the breakdown rows — matches
 *  `buildNeedsYouQueue`'s `DISPLAY_ORDER` (spec §4.1). */
const GROUP_ORDER: NeedsYouGroupKey[] = ['expires-today', 'at-risk', 'ready-to-issue', 'cancelled'];

const GROUP_LABELS: Record<NeedsYouGroupKey, string> = {
  'expires-today': 'Expiring today',
  'at-risk': 'At risk of running short',
  'ready-to-issue': 'Ready to issue',
  cancelled: 'Cancelled, cast not notified',
};

const GROUP_DOT_CLASS: Record<NeedsYouGroupKey, string> = {
  'expires-today': 'bg-destructive',
  'at-risk': 'bg-warning',
  'ready-to-issue': 'bg-primary',
  cancelled: 'bg-muted-foreground',
};

const RULES: string[] = [
  'Offers expiring today, so they do not lapse unanswered.',
  'Dates at risk of running short of confirmed cast before the show.',
  'Dates whose cast is confirmed and ready for a hire order.',
  'Cancelled dates the cast has not been notified about yet.',
];

/**
 * Right rail for the producer "Needs you" lens (spec §3.4): a "Clear the
 * queue" progress card (`clearedToday` against `queue.totalItems`, plus a
 * per-group breakdown from `queue.countByGroup`), an eligible-artist
 * shortlist card for the queue's top at-risk date, and a static "What lands
 * here" rules card. Purely presentational — `queue`/`clearedToday`/
 * `shortlist` are all caller-derived state; the only side effect is
 * `onOffer`, fired per shortlist row.
 */
export function QueueRail({ queue, clearedToday, shortlist, onOffer, className }: QueueRailProps) {
  // Denominator is "already cleared" + "still in the queue"; with nothing in
  // either bucket there's nothing left to clear, so the bar reads full.
  const denominator = clearedToday + queue.totalItems;
  const progressPct = denominator > 0 ? Math.round((clearedToday / denominator) * 100) : 100;

  const breakdown = GROUP_ORDER
    .map((key) => ({ key, count: queue.countByGroup[key] }))
    .filter((row) => row.count > 0);

  return (
    <div data-testid="queue-rail" className={cn('flex flex-col gap-3', className)}>
      <div data-testid="queue-rail-progress" className="rounded-m border border-border bg-card p-3.5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            Clear the queue
          </p>
          <span className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-foreground">
            {clearedToday} cleared today
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-pill bg-muted">
          <div
            data-testid="queue-rail-progress-bar"
            className="h-1 rounded-pill bg-primary"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {breakdown.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {breakdown.map(({ key, count }) => (
              <div key={key} className="flex items-center gap-2">
                <span className={cn('h-1 w-2.5 shrink-0 rounded-full', GROUP_DOT_CLASS[key])} />
                <span className="text-[12.5px] text-foreground">{GROUP_LABELS[key]}</span>
                <span className="ml-auto font-mono text-xs font-medium tabular-nums text-foreground">
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {shortlist && (
        <div data-testid="queue-rail-shortlist" className="overflow-hidden rounded-m border border-border bg-card">
          <div className="border-b border-border px-3.5 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
              Shortlist
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{shortlist.dateLabel}</p>
          </div>
          {shortlist.artists.length > 0 ? (
            shortlist.artists.map((artist) => (
              <div
                key={artist.artistId}
                data-testid={`queue-shortlist-row-${artist.artistId}`}
                className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {artist.name}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  data-testid={`queue-offer-${artist.artistId}`}
                  onClick={() => onOffer?.(shortlist.dateId, artist.artistId)}
                >
                  Offer
                </Button>
              </div>
            ))
          ) : (
            <p className="px-3.5 py-2.5 text-xs text-muted-foreground">No eligible artists for this date.</p>
          )}
        </div>
      )}

      <div data-testid="queue-rail-rules" className="rounded-m border border-border bg-muted p-3.5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          What lands here
        </p>
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {RULES.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
