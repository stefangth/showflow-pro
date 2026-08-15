import { format } from 'date-fns';
import type { ActionGates, ArtistDateEntry, ArtistStatus, ProducerActionKey, ProducerDateEntry, Tone } from '@/lib/calendar/types';
import { ARTIST_TONES, PRODUCER_TONES, TONE_TEXT, artistStatusLabel } from '@/lib/calendar/tone';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { FillMeter } from './FillMeter';

export interface DayRailStat {
  label: string;
  value: string;
  dotClass: string;
}

export interface DayRailLegendItem {
  label: string;
  badgeClass: string;
  railClass: string;
}

interface DayRailProps {
  role: 'producer' | 'artist';
  day: Date;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  stats: DayRailStat[];
  legend: DayRailLegendItem[];
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
  className?: string;
}

/** Producer primary-action default (spec §3.4): "Confirm holds" beats
 *  "Generate hire order" when a day has both — accepted-but-unconfirmed
 *  slots are the more urgent, blocking action. A `fully_filled` entry only
 *  offers Generate when it has no active order yet (`hireOrderId == null`);
 *  an already-ordered date falls through to `undefined` so the rail's
 *  secondary "Open date" action is the only one offered. `undefined` = no
 *  primary action, so the caller may still force one via `primaryLabel`. */
function producerPrimaryLabel(entries: ProducerDateEntry[]): string | undefined {
  if (entries.some(e => e.acceptedMain > 0)) return 'Confirm holds';
  if (entries.some(e => e.status === 'fully_filled' && e.hireOrderId == null)) return 'Generate hire order';
  return undefined;
}

/** Same priority as `producerPrimaryLabel`, but returns the `ActionGates` key
 *  the resolved primary button maps to (or `undefined` when there is no
 *  primary action to gate) — lets the rail look up the caller's capability
 *  gate for whichever action it ends up rendering. */
function producerPrimaryKind(entries: ProducerDateEntry[]): ProducerActionKey | undefined {
  if (entries.some(e => e.acceptedMain > 0)) return 'confirmHolds';
  if (entries.some(e => e.status === 'fully_filled' && e.hireOrderId == null)) return 'generateHireOrder';
  return undefined;
}

/** Artist primary-action default (spec §4): a pending offer to answer beats
 *  nudging toward blocking an unoffered date. */
function artistPrimaryLabel(entries: ArtistDateEntry[]): string | undefined {
  if (entries.some(e => e.myStatus === 'suggested')) return 'Accept offer';
  if (entries.some(e => e.myStatus === 'unanswered')) return 'Block date';
  return undefined;
}

/** Summed main-cast deficit (`mainSlots - confirmedMain`, floored at 0)
 *  across non-cancelled entries — mirrors `producerData.ts`'s month-cell
 *  flag derivation, reused here for the rail header's casting/filled state
 *  and the "N slots still open" sub-line. */
function producerOpenSlots(entries: ProducerDateEntry[]): number {
  return entries
    .filter(e => e.status !== 'cancelled')
    .reduce((sum, e) => sum + Math.max(0, e.mainSlots - e.confirmedMain), 0);
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
 * Derives the rail card's header (eyebrow + title + sub, design lines
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
  statusLabels?: Partial<Record<ArtistStatus, string>>,
): RailHeader {
  const dateLabel = format(day, 'EEE d MMM');
  const entries = role === 'producer' ? producerEntries : artistEntries;

  if (entries.length === 0) {
    return {
      eyebrow: `${dateLabel} · nothing scheduled`,
      eyebrowTone: 'muted',
      title: 'Pick a day',
      sub: 'Select a day to see its dates and act on them.',
    };
  }

  if (role === 'producer') {
    const openSlots = producerOpenSlots(producerEntries);
    const casting = openSlots > 0;
    return {
      eyebrow: `${dateLabel} · ${casting ? 'casting' : 'fully filled'}`,
      eyebrowTone: casting ? 'warning' : 'success',
      title: entryTitle(producerEntries[0]),
      sub: `${producerEntries.length} date${producerEntries.length === 1 ? '' : 's'} · ${
        casting ? `${openSlots} slots still open` : 'cast complete'
      }`,
    };
  }

  const toneSpec = ARTIST_TONES[artistEntries[0].myStatus];
  const label = artistStatusLabel(artistEntries[0].myStatus, statusLabels);
  return {
    eyebrow: `${dateLabel} · ${label.toLowerCase()}`,
    eyebrowTone: toneSpec.tone,
    title: entryTitle(artistEntries[0]),
    sub: 'Your commitment on this date',
  };
}

function ProducerDayCard({ entry }: { entry: ProducerDateEntry }) {
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
        <p className={cn('mt-1.5 text-xs', TONE_TEXT[toneSpec.tone])}>{toneSpec.label}</p>
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
 * Shared right rail for the Month/Agenda lenses: the selected day's date
 * card(s), a stats card, and a Legend card (design lines 655-728). Producer
 * cards show a fill meter + `confirmedMain/mainSlots main`; artist cards
 * (no slot counts on `ArtistDateEntry`) show a status note instead. The
 * primary/secondary action labels default per role from the day's entries
 * (see `producerPrimaryLabel`/`artistPrimaryLabel`) unless the caller
 * overrides them via `primaryLabel`/`secondaryLabel`.
 */
export function DayRail({
  role,
  day,
  producerEntries,
  artistEntries,
  stats,
  legend,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  statusLabels,
  actionGates,
  className,
}: DayRailProps) {
  const resolvedProducerEntries = producerEntries ?? [];
  const resolvedArtistEntries = artistEntries ?? [];
  const entries = role === 'producer' ? resolvedProducerEntries : resolvedArtistEntries;

  const header = buildRailHeader(role, day, resolvedProducerEntries, resolvedArtistEntries, statusLabels);
  const statsTitle = role === 'producer' ? 'This month' : `Your ${format(day, 'MMMM')}`;
  const emptyText = role === 'producer' ? 'No dates scheduled on this day.' : 'No date offered to you on this day.';

  const resolvedPrimaryLabel =
    primaryLabel ??
    (role === 'producer'
      ? producerPrimaryLabel(resolvedProducerEntries)
      : artistPrimaryLabel(resolvedArtistEntries));
  const resolvedSecondaryLabel = secondaryLabel ?? (role === 'producer' ? 'Open date' : 'Message producer');

  // Only the producer primary maps to a capability-gated action (Confirm
  // holds / Generate hire order); "Open date" and every artist action are
  // never gated (see `ActionGates`'s doc comment).
  const primaryKind = role === 'producer' ? producerPrimaryKind(resolvedProducerEntries) : undefined;
  const primaryGate = primaryKind ? actionGates?.[primaryKind] : undefined;
  const primaryDisabled = primaryGate?.disabled ?? false;

  return (
    <div data-testid="day-rail" data-day={toDateKey(day)} className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-hidden rounded-m border border-border bg-card shadow-elev1">
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

          <p className="font-mono text-[11px] text-muted-foreground">↵ open · space select</p>
        </div>
      </div>

      <div className="rounded-m border border-border bg-muted p-3.5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          {statsTitle}
        </p>
        <div className="flex flex-col gap-2">
          {stats.map((stat, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={cn('h-1 w-2.5 shrink-0 rounded-full', stat.dotClass)} />
              <span className="text-[12.5px] text-foreground">{stat.label}</span>
              <span className="ml-auto font-mono text-xs font-medium tabular-nums text-foreground">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-m border border-border bg-card p-3.5">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          Legend
        </p>
        <div className="flex flex-col gap-1.5">
          {legend.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="relative h-[11px] w-4 shrink-0 overflow-hidden rounded-[3px]">
                <span className={cn('absolute inset-0', item.badgeClass)} />
                <span className={cn('absolute inset-y-0 left-0 w-0.5', item.railClass)} />
              </span>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
