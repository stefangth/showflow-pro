import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';
import { ARTIST_TONES, PRODUCER_TONES, TONE_TEXT } from '@/lib/calendar/tone';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  className?: string;
}

/** Producer primary-action default (spec §3.4): "Confirm holds" beats
 *  "Generate hire order" when a day has both — accepted-but-unconfirmed
 *  slots are the more urgent, blocking action. `undefined` = no primary
 *  action, so the caller may still force one via `primaryLabel`. */
function producerPrimaryLabel(entries: ProducerDateEntry[]): string | undefined {
  if (entries.some(e => e.acceptedMain > 0)) return 'Confirm holds';
  if (entries.some(e => e.status === 'fully_filled')) return 'Generate hire order';
  return undefined;
}

/** Artist primary-action default (spec §4): a pending offer to answer beats
 *  nudging toward blocking an unoffered date. */
function artistPrimaryLabel(entries: ArtistDateEntry[]): string | undefined {
  if (entries.some(e => e.myStatus === 'suggested')) return 'Accept offer';
  if (entries.some(e => e.myStatus === 'unanswered')) return 'Block date';
  return undefined;
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
    </div>
  );
}

function ArtistDayCard({ entry }: { entry: ArtistDateEntry }) {
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
      <p className={cn('mt-1.5 text-xs', TONE_TEXT[toneSpec.tone])}>{toneSpec.label}</p>
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
  className,
}: DayRailProps) {
  const entries = role === 'producer' ? producerEntries ?? [] : artistEntries ?? [];

  const resolvedPrimaryLabel =
    primaryLabel ??
    (role === 'producer'
      ? producerPrimaryLabel(producerEntries ?? [])
      : artistPrimaryLabel(artistEntries ?? []));
  const resolvedSecondaryLabel = secondaryLabel ?? (role === 'producer' ? 'Open date' : 'Message producer');

  return (
    <div data-testid="day-rail" data-day={toDateKey(day)} className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-hidden rounded-m border border-border bg-card shadow-elev1">
        <div className="flex flex-col gap-3.5 p-4">
          {entries.length > 0 ? (
            role === 'producer' ? (
              (producerEntries ?? []).map(entry => <ProducerDayCard key={entry.id} entry={entry} />)
            ) : (
              (artistEntries ?? []).map(entry => <ArtistDayCard key={entry.id} entry={entry} />)
            )
          ) : (
            <p data-testid="day-rail-empty" className="text-[13px] text-muted-foreground">
              Nothing scheduled this day.
            </p>
          )}

          {(resolvedPrimaryLabel || resolvedSecondaryLabel) && (
            <div className="flex gap-2">
              {resolvedPrimaryLabel && (
                <Button
                  type="button"
                  className="flex-1"
                  data-testid="day-rail-primary"
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
          Overview
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
