import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { ArtistDateEntry, ArtistStatus } from '@/lib/calendar/types';
import { ARTIST_TONES, artistStatusLabel } from '@/lib/calendar/tone';
import { dfLocale, isPastDate } from '@/lib/dates';
import { sessionLabel } from '@/lib/calendar/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';

export interface AnsweredTodayRow {
  date: string;
  title: string;
  venue: string;
  label: string;
  badgeClass: string;
}

interface OffersLensProps {
  entries: ArtistDateEntry[];
  onAccept: (bookingId: string) => void;
  onDecline: (bookingId: string) => void;
  onBlock: (dateId: string, date: Date) => void;
  answeredToday: AnsweredTodayRow[];
  notOfferedYet: ArtistDateEntry[];
  /** Flow-aware artist status label override (see `artistStatusLabel`). */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Override for "today", so tests get a deterministic upcoming filter. */
  today?: Date;
  className?: string;
}

function entryTitle(entry: ArtistDateEntry): string {
  return entry.program + (entry.subProgram ? ` · ${entry.subProgram}` : '');
}

/** Venue + session time, joined for the queue card's detail line — skips
 *  either half when absent rather than leaving a stray separator. */
function entryDetail(entry: ArtistDateEntry): string {
  return [entry.venue, sessionLabel(entry.session1)].filter(Boolean).join(' · ');
}

/**
 * Artist Offers lens: a queue of cards for offers awaiting a response —
 * `suggested` bookings (live: Accept/Decline/Block date) and upcoming
 * `soft_booked` holds (status-only: a Hold chip, no actions) — design lines
 * 465-538. Below the queue, a progress row (answered vs. still-open offers)
 * and two read-mostly cards: "Answered today" (rows the caller already
 * resolved via `answeredToday`; "Undo last" is an inert stub per the brief)
 * and "Later this month · not offered yet" (`notOfferedYet`, each row with
 * its own Block-date button). Purely presentational: mutations are wired by
 * the caller via `onAccept`/`onDecline`/`onBlock`. Each queue card's 3-column
 * row (date · content · actions) reflows to a single-column stack below the
 * `md:` breakpoint (768px, matching `useIsMobile`) via responsive classes.
 */
export function OffersLens({
  entries,
  onAccept,
  onDecline,
  onBlock,
  answeredToday,
  notOfferedYet,
  statusLabels,
  today = new Date(),
  className,
}: OffersLensProps) {
  const { t } = useTranslation('availability');
  const queue = entries
    .filter((e) => e.myStatus === 'suggested' || (e.myStatus === 'soft_booked' && !isPastDate(e.date, today)))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const openOfferCount = queue.filter((e) => e.myStatus === 'suggested').length;
  const answeredCount = answeredToday.length;
  const totalToAnswer = answeredCount + openOfferCount;
  const progressPct = totalToAnswer > 0 ? Math.round((answeredCount / totalToAnswer) * 100) : 0;

  return (
    <div data-testid="offers-lens" className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2.5">
        {queue.map((entry) => {
          const isLive = entry.myStatus === 'suggested';
          const toneSpec = ARTIST_TONES[entry.myStatus];
          const detail = entryDetail(entry);

          return (
            <div
              key={entry.id}
              data-testid={`offer-card-${entry.id}`}
              // Mobile-first: the card stacks single-column (spec §4.1);
              // `md:` restores the desktop 3-column row exactly at >=768px
              // (matching `useIsMobile`'s breakpoint) — every `md:`-only
              // utility below reproduces a value this card already had.
              className="flex flex-col overflow-hidden rounded-l border border-border bg-card shadow-elev1 md:flex-row md:items-stretch"
            >
              <div className="flex w-full shrink-0 flex-row items-center justify-start gap-2 border-b border-border bg-muted px-4 py-2.5 text-left md:w-[92px] md:flex-col md:items-center md:justify-center md:gap-0 md:border-b-0 md:border-r md:px-0 md:py-4 md:text-center">
                <Eyebrow>{format(entry.date, 'EEE', { locale: dfLocale() })}</Eyebrow>
                <p className="font-mono text-display-sm font-semibold leading-8 tabular-nums text-foreground">
                  {format(entry.date, 'd')}
                </p>
                <p className="text-eyebrow text-muted-foreground">{format(entry.date, 'MMM', { locale: dfLocale() })}</p>
              </div>

              <div className="w-full min-w-0 px-4 py-3.5 md:flex-1">
                <Eyebrow className={isLive ? 'text-primary' : 'text-warning'}>
                  {isLive ? t('calendar.offers.offerLabel', { program: entry.program }) : t('calendar.offers.holdPlaced')}
                </Eyebrow>
                <p className="mt-1 text-title-sm font-semibold tracking-tight text-foreground">
                  {entryTitle(entry)}
                </p>
                {detail && <p className="mt-0.5 text-control text-muted-foreground">{detail}</p>}
              </div>

              <div className="flex w-full shrink-0 flex-col justify-center gap-2 px-4 py-3.5 md:w-[232px]">
                {isLive ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      data-testid={`offer-accept-${entry.id}`}
                      // Domain invariant: a `suggested` entry is always
                      // sourced from a live booking row, so bookingId is set.
                      onClick={() => onAccept(entry.bookingId!)}
                    >
                      {t('calendar.offers.accept')}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        data-testid={`offer-decline-${entry.id}`}
                        onClick={() => onDecline(entry.bookingId!)}
                      >
                        {t('calendar.offers.decline')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        data-testid={`offer-block-${entry.id}`}
                        onClick={() => onBlock(entry.id, entry.date)}
                      >
                        {t('calendar.shared.blockDate')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 text-eyebrow font-medium',
                        toneSpec.badgeClass
                      )}
                    >
                      {artistStatusLabel(entry.myStatus, statusLabels)}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('calendar.offers.awaitingConfirmation')}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 px-0.5">
        <span className="whitespace-nowrap font-mono text-eyebrow text-muted-foreground">
          {t('calendar.offersProgress.keyboardHint')}
        </span>
        <span
          data-testid="offers-progress-label"
          className="ml-auto whitespace-nowrap text-xs font-medium text-muted-foreground"
        >
          {t('calendar.offersProgress.answeredCount', { answered: answeredCount, total: totalToAnswer })}
        </span>
        <div className="h-1 w-[120px] shrink-0 overflow-hidden rounded-pill bg-muted">
          <div
            data-testid="offers-progress-bar"
            className="h-1 rounded-pill bg-primary"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-m border border-border bg-muted">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Eyebrow>{t('calendar.offersAnswered.title')}</Eyebrow>
          <span className="font-mono text-eyebrow text-muted-foreground">{answeredToday.length}</span>
          {/* "Undo last" is an inert stub for now — wired up in a later wave. */}
          <span className="ml-auto cursor-pointer text-xs font-medium text-primary">{t('calendar.offersAnswered.undoLast')}</span>
        </div>
        {answeredToday.map((row, i) => (
          <div
            key={`${row.date}-${i}`}
            data-testid={`answered-row-${i}`}
            className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0"
          >
            <span className="w-[52px] shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground">
              {row.date}
            </span>
            <span className="min-w-0 flex-1 truncate text-control font-medium text-foreground">{row.title}</span>
            <span className="truncate text-xs text-muted-foreground">{row.venue}</span>
            <span
              className={cn(
                'ml-auto inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 text-eyebrow font-medium',
                row.badgeClass
              )}
            >
              {row.label}
            </span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-m border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Eyebrow>{t('calendar.notOffered.title')}</Eyebrow>
          <span className="ml-auto text-xs text-muted-foreground">{t('calendar.notOffered.eligibleFromCasts')}</span>
        </div>
        {notOfferedYet.map((entry) => (
          <div
            key={entry.id}
            data-testid={`not-offered-row-${entry.id}`}
            className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0"
          >
            <span className="w-[52px] shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground">
              {format(entry.date, 'd MMM', { locale: dfLocale() })}
            </span>
            <span className="min-w-0 flex-1 truncate text-control font-medium text-foreground">
              {entryTitle(entry)}
            </span>
            <span className="truncate text-xs text-muted-foreground">{entry.venue}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              data-testid={`not-offered-block-${entry.id}`}
              onClick={() => onBlock(entry.id, entry.date)}
            >
              {t('calendar.shared.blockDate')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
