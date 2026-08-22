import { useTranslation } from 'react-i18next';
import { DISPLAY_ORDER, RISK_WINDOW_DAYS } from '@/lib/calendar/needsYou';
import type { NeedsYouGroupKey, NeedsYouQueue } from '@/lib/calendar/needsYou';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';

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

const GROUP_DOT_CLASS: Record<NeedsYouGroupKey, string> = {
  'expires-today': 'bg-destructive',
  'at-risk': 'bg-warning',
  'ready-to-issue': 'bg-primary',
  cancelled: 'bg-muted-foreground',
};

// Rule copy keys, in the same order the rules render — each resolves under
// `calendar.queue.rules.*` (see the bookings catalog).
const RULE_KEYS = ['expiresToday', 'atRisk', 'readyToIssue', 'cancelled'] as const;

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
  const { t } = useTranslation('bookings');
  // Denominator is "already cleared" + "still in the queue"; with nothing in
  // either bucket there's nothing left to clear, so the bar reads full.
  const denominator = clearedToday + queue.totalItems;
  const progressPct = denominator > 0 ? Math.round((clearedToday / denominator) * 100) : 100;

  const breakdown = DISPLAY_ORDER
    .map((key) => ({ key, count: queue.countByGroup[key] }))
    .filter((row) => row.count > 0);

  return (
    <div data-testid="queue-rail" className={cn('flex flex-col gap-3', className)}>
      <div data-testid="queue-rail-progress" className="rounded-m border border-border bg-card p-3.5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <Eyebrow>{t('calendar.queue.clearQueueTitle')}</Eyebrow>
          <span className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-foreground">
            {t('calendar.queue.clearedToday', { count: clearedToday })}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-pill bg-well-tint">
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
                <span className="text-control text-foreground">
                  {t(`calendar.needsYou.groups.${key}`, { days: RISK_WINDOW_DAYS })}
                </span>
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
            <Eyebrow>{t('calendar.queue.shortlistTitle')}</Eyebrow>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{shortlist.dateLabel}</p>
          </div>
          {shortlist.artists.length > 0 ? (
            shortlist.artists.map((artist) => (
              <div
                key={artist.artistId}
                data-testid={`queue-shortlist-row-${artist.artistId}`}
                className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-control font-medium text-foreground">
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
                  {t('calendar.queue.offerButton')}
                </Button>
              </div>
            ))
          ) : (
            <p className="px-3.5 py-2.5 text-xs text-muted-foreground">{t('calendar.queue.shortlistEmpty')}</p>
          )}
        </div>
      )}

      <div data-testid="queue-rail-rules" className="rounded-m border border-border bg-well-tint p-3.5">
        <Eyebrow className="mb-2.5">{t('calendar.queue.rulesTitle')}</Eyebrow>
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {RULE_KEYS.map((key) => (
            <li key={key}>{t(`calendar.queue.rules.${key}`, { days: RISK_WINDOW_DAYS })}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
