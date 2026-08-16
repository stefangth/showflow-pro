import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ActionGates, ArtistDateEntry, ArtistStatus, ProducerDateEntry, Tone } from '@/lib/calendar/types';
import { berlinDateKey, dfLocale, toDateKey } from '@/lib/dates';
import { ARTIST_TONES, PRODUCER_TONES, TONE_TEXT, artistStatusLabel } from '@/lib/calendar/tone';
import { resolveProducerPrimary } from '@/lib/calendar/producerPrimary';
import { unconfirmedSlots } from '@/lib/calendar/slots';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { FillMeter } from './FillMeter';

export interface DayDetailProps {
  role: 'producer' | 'artist';
  day: Date;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  onPrimary?: () => void;
  primaryLabel?: string;
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Flow-aware artist status label override (see `artistStatusLabel`).
   *  Ignored for `role="producer"`. */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Capability gates for the producer primary action (Confirm holds /
   *  Generate hire order). Ignored for `role="artist"` — artist actions
   *  (accept/decline/block) are not capability-gated. When the resolved
   *  primary action's kind is gated `disabled`, the primary button renders
   *  `disabled` with `title` as its tooltip instead of firing `onPrimary`. */
  actionGates?: ActionGates;
  /** Suppresses the secondary button entirely (default label and all).
   *  Set only by `CalendarDaySheet`, which renders its own dedicated
   *  "Open date" / "Message producer" text buttons below this card instead
   *  — without this escape hatch those would duplicate DayDetail's default
   *  secondary label. `DayRail` never sets it, so its desktop output is
   *  unaffected. */
  hideSecondary?: boolean;
  /** Renders the artist offer info tiles (Session, Expires) above the action
   *  buttons — set only by `CalendarDaySheet` for the mobile artist sheet
   *  (design mock 2c). `DayRail` never sets it, so the desktop rail is
   *  unaffected/byte-identical. Ignored for `role="producer"`. Call time is
   *  intentionally omitted (locked "omit call time" decision). Each tile
   *  hides when its source is absent — the Expires tile stays dark until the
   *  offer's `offerExpiresAt` clock has started. */
  showInfoTiles?: boolean;
  className?: string;
}

/** Bound to the three namespaces this card draws copy from: producer status /
 *  actions (`bookings`), artist actions/labels (`availability`), and the
 *  role-agnostic empty-day + key-hint chrome (`common`). */
type DayTF = TFunction<['bookings', 'availability', 'common']>;

interface InfoTile {
  key: string;
  label: string;
  value: string;
  warn?: boolean;
}

/** Session + Expires tiles for the mobile artist sheet, derived from the entry
 *  the primary action targets: the first pending offer (matching
 *  `artistPrimaryLabel`'s "Accept offer" selection) so the tiles describe the
 *  offer being acted on, falling back to the day's first entry otherwise. Call
 *  time is deliberately excluded. */
function artistInfoTiles(day: Date, entries: ArtistDateEntry[], t: DayTF): InfoTile[] {
  const entry = entries.find(e => e.myStatus === 'suggested') ?? entries[0];
  if (!entry) return [];
  const tiles: InfoTile[] = [];
  if (entry.session1) tiles.push({ key: 'session', label: t('availability:calendar.day.session'), value: entry.session1 });
  if (entry.offerExpiresAt) {
    const expiry = new Date(entry.offerExpiresAt);
    // Compare on the Berlin calendar (the booking engine anchors offer-expiry
    // deadlines to Berlin — see `earliestExpiryToday`/`berlinDateKey`), so the
    // time-vs-date format doesn't flip near midnight in another timezone.
    const sameDay = berlinDateKey(expiry) === toDateKey(day);
    tiles.push({
      key: 'expires',
      label: t('availability:calendar.day.expires'),
      value: sameDay ? format(expiry, 'HH:mm') : format(expiry, 'd MMM', { locale: dfLocale() }),
      warn: true,
    });
  }
  return tiles;
}

/** Artist primary-action default (spec §4): a pending offer to answer beats
 *  nudging toward blocking an unoffered date. */
function artistPrimaryLabel(entries: ArtistDateEntry[], t: DayTF): string | undefined {
  if (entries.some(e => e.myStatus === 'suggested')) return t('availability:calendar.day.primaryAccept');
  if (entries.some(e => e.myStatus === 'unanswered')) return t('availability:calendar.day.primaryBlock');
  return undefined;
}

/** Summed main-cast deficit (`mainSlots - confirmedMain`, floored at 0)
 *  across non-cancelled entries — mirrors `producerData.ts`'s month-cell
 *  flag derivation, reused here for the rail header's casting/filled state
 *  and the "N slots still open" sub-line. */
function producerOpenSlots(entries: ProducerDateEntry[]): number {
  return entries
    .filter(e => e.status !== 'cancelled')
    .reduce((sum, e) => sum + unconfirmedSlots(e), 0);
}

interface RailHeader {
  eyebrow: string;
  eyebrowTone: Tone;
  title: string;
  sub: string;
}

function entryTitle(entry: ProducerDateEntry | ArtistDateEntry): string {
  return entry.program + (entry.subProgram ? ` · ${entry.subProgram}` : '');
}

/**
 * Derives the date card's header (eyebrow + title + sub, design lines
 * 658-661) purely from `day`/entries/`role` — no extra props needed. The
 * eyebrow is `"{EEE d MMM}"` plus a status suffix: "nothing scheduled" (no
 * entries), producer "casting"/"fully filled" (any open main slots across
 * non-cancelled entries, or not), or the artist's own status label
 * lowercased. The title is the first entry's `program · subProgram`, or
 * "Pick a day" when the day is empty.
 */
function buildRailHeader(
  role: 'producer' | 'artist',
  day: Date,
  producerEntries: ProducerDateEntry[],
  artistEntries: ArtistDateEntry[],
  t: DayTF,
  statusLabels?: Partial<Record<ArtistStatus, string>>,
): RailHeader {
  const dateLabel = format(day, 'EEE d MMM', { locale: dfLocale() });
  const entries = role === 'producer' ? producerEntries : artistEntries;

  if (entries.length === 0) {
    return {
      eyebrow: `${dateLabel} · ${t('common:calendar.day.nothingScheduled')}`,
      eyebrowTone: 'muted',
      title: t('common:calendar.day.pickADay'),
      sub: t('common:calendar.day.pickADayHint'),
    };
  }

  if (role === 'producer') {
    const openSlots = producerOpenSlots(producerEntries);
    const casting = openSlots > 0;
    return {
      eyebrow: `${dateLabel} · ${t(casting ? 'calendar.day.eyebrowCasting' : 'calendar.day.eyebrowFullyFilled')}`,
      eyebrowTone: casting ? 'warning' : 'success',
      title: entryTitle(producerEntries[0]),
      sub: casting
        ? t('calendar.day.subCasting', { count: producerEntries.length, open: openSlots })
        : t('calendar.day.subComplete', { count: producerEntries.length }),
    };
  }

  const toneSpec = ARTIST_TONES[artistEntries[0].myStatus];
  const label = artistStatusLabel(artistEntries[0].myStatus, statusLabels);
  return {
    eyebrow: `${dateLabel} · ${label.toLowerCase()}`,
    eyebrowTone: toneSpec.tone,
    title: entryTitle(artistEntries[0]),
    sub: t('availability:calendar.day.sub'),
  };
}

function ProducerDayCard({ entry }: { entry: ProducerDateEntry }) {
  const { t } = useTranslation('bookings');
  const toneSpec = PRODUCER_TONES[entry.status];
  const meter =
    entry.mainSlots > 0
      ? Array.from({ length: entry.mainSlots }, (_, i) => ({ filled: i < entry.confirmedMain }))
      : null;

  return (
    <div data-testid={`day-rail-entry-${entry.id}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">
          {entry.program}
          {entry.subProgram ? ` · ${entry.subProgram}` : ''}
        </p>
        {entry.session1 && (
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
            {entry.session1}
          </span>
        )}
      </div>
      {entry.venue && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {entry.venue}
          {entry.city ? ` · ${entry.city}` : ''}
        </p>
      )}
      {meter ? (
        <div className="mt-1.5 flex items-center gap-2">
          <FillMeter segments={meter} tone={toneSpec.tone} />
          <span className={cn('font-mono text-[11px] font-medium', TONE_TEXT[toneSpec.tone])}>
            {entry.confirmedMain}/{entry.mainSlots} main
          </span>
        </div>
      ) : (
        <p className={cn('mt-1.5 text-xs', TONE_TEXT[toneSpec.tone])}>{t(`calendar.producerStatus.${entry.status}`)}</p>
      )}
      {entry.hireOrderId && entry.hireOrderStatus && (
        <div className="mt-1.5" data-testid={`day-rail-order-status-${entry.id}`}>
          <HireOrderStatusBadge status={entry.hireOrderStatus} />
        </div>
      )}
    </div>
  );
}

function ArtistDayCard({ entry, statusLabels }: { entry: ArtistDateEntry; statusLabels?: Partial<Record<ArtistStatus, string>> }) {
  const toneSpec = ARTIST_TONES[entry.myStatus];

  return (
    <div data-testid={`day-rail-entry-${entry.id}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">
          {entry.program}
          {entry.subProgram ? ` · ${entry.subProgram}` : ''}
        </p>
        {entry.session1 && (
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
            {entry.session1}
          </span>
        )}
      </div>
      {entry.venue && <p className="mt-0.5 text-xs text-muted-foreground">{entry.venue}</p>}
      <p className={cn('mt-1.5 text-xs', TONE_TEXT[toneSpec.tone])}>{artistStatusLabel(entry.myStatus, statusLabels)}</p>
    </div>
  );
}

/**
 * The selected day's date card(s) (fill meter for producer / status note for
 * artist, session-only times) plus the primary/secondary action buttons
 * (design lines 655-694). Extracted out of `DayRail` (which renders this
 * followed by its own stats + legend cards) so the same date-card + actions
 * surface can be reused inside the mobile day-detail sheet. The
 * primary/secondary action labels default per role from the day's entries
 * (see `resolveProducerPrimary`/`artistPrimaryLabel`) unless the caller
 * overrides them via `primaryLabel`/`secondaryLabel`.
 */
export function DayDetail({
  role,
  day,
  producerEntries,
  artistEntries,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  statusLabels,
  actionGates,
  hideSecondary,
  showInfoTiles,
  className,
}: DayDetailProps) {
  const { t } = useTranslation(['bookings', 'availability', 'common']);
  const resolvedProducerEntries = producerEntries ?? [];
  const resolvedArtistEntries = artistEntries ?? [];
  const entries = role === 'producer' ? resolvedProducerEntries : resolvedArtistEntries;
  const infoTiles = role === 'artist' && showInfoTiles ? artistInfoTiles(day, resolvedArtistEntries, t) : [];

  const header = buildRailHeader(role, day, resolvedProducerEntries, resolvedArtistEntries, t, statusLabels);
  const emptyText = role === 'producer' ? t('calendar.day.empty') : t('availability:calendar.day.empty');

  // Single resolution — feeds both the label below and the gate lookup, so
  // they can never point at different actions (see `resolveProducerPrimary`).
  const producerPrimary = role === 'producer' ? resolveProducerPrimary(resolvedProducerEntries) : null;

  const resolvedPrimaryLabel =
    primaryLabel ??
    (role === 'producer'
      ? producerPrimary
        ? t(`calendar.primary.${producerPrimary.kind}`)
        : undefined
      : artistPrimaryLabel(resolvedArtistEntries, t));
  const resolvedSecondaryLabel = hideSecondary
    ? undefined
    : secondaryLabel ??
      (role === 'producer' ? t('common:calendar.day.openDate') : t('availability:calendar.day.messageProducer'));

  // Only the producer primary maps to a capability-gated action (Confirm
  // holds / Generate hire order); "Open date" and every artist action are
  // never gated (see `ActionGates`'s doc comment).
  const primaryGate = producerPrimary ? actionGates?.[producerPrimary.kind] : undefined;
  const primaryDisabled = primaryGate?.disabled ?? false;

  return (
    <div className={cn('overflow-hidden rounded-m border border-border bg-card shadow-elev1', className)}>
      <div data-testid="day-rail-header" className="border-b border-border px-4 pb-3 pt-3.5">
        <p className={cn('mb-1 text-[11px] font-semibold uppercase tracking-[1.6px]', TONE_TEXT[header.eyebrowTone])}>
          {header.eyebrow}
        </p>
        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">{header.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{header.sub}</p>
      </div>

      <div className="flex flex-col gap-3.5 p-4">
        {entries.length > 0 ? (
          role === 'producer' ? (
            resolvedProducerEntries.map(entry => <ProducerDayCard key={entry.id} entry={entry} />)
          ) : (
            resolvedArtistEntries.map(entry => <ArtistDayCard key={entry.id} entry={entry} statusLabels={statusLabels} />)
          )
        ) : (
          <p data-testid="day-rail-empty" className="text-[13px] text-muted-foreground">
            {emptyText}
          </p>
        )}

        {infoTiles.length > 0 && (
          <div data-testid="day-detail-tiles" className="grid grid-cols-2 gap-2">
            {infoTiles.map(tile => (
              <div
                key={tile.key}
                data-testid={`day-detail-tile-${tile.key}`}
                className={cn(
                  'rounded-m border px-3 py-2',
                  tile.warn ? 'border-warning/40 bg-warning/10' : 'border-border'
                )}
              >
                <p className={cn('text-[10px] font-semibold uppercase tracking-wide', tile.warn ? 'text-warning' : 'text-muted-foreground')}>
                  {tile.label}
                </p>
                <p className={cn('mt-0.5 font-mono text-sm font-semibold', tile.warn ? 'text-warning' : 'text-foreground')}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {(resolvedPrimaryLabel || resolvedSecondaryLabel) && (
          <div className="flex gap-2">
            {resolvedPrimaryLabel && (
              <Button
                type="button"
                className="flex-1"
                data-testid="day-rail-primary"
                disabled={primaryDisabled}
                title={primaryDisabled ? primaryGate?.title : undefined}
                onClick={() => onPrimary?.()}
              >
                {resolvedPrimaryLabel}
              </Button>
            )}
            {resolvedSecondaryLabel && (
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                data-testid="day-rail-secondary"
                onClick={() => onSecondary?.()}
              >
                {resolvedSecondaryLabel}
              </Button>
            )}
          </div>
        )}

        <p className="font-mono text-[11px] text-muted-foreground">{t('common:calendar.day.keyHint')}</p>
      </div>
    </div>
  );
}
