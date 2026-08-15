import { useState, type ReactNode } from 'react';
import type {
  ArtistDateEntry,
  ArtistStatus,
  ProducerDateEntry,
  ProducerStatus,
  Tone,
} from '@/lib/calendar/types';
import { PRODUCER_TONES, ARTIST_TONES } from '@/lib/calendar/tone';
import { periodLabel, periodWindow, shiftPeriod } from '@/lib/calendar/period';
import { isPastDate, toDateKey } from '@/lib/dates';
import { ROUTES } from '@/config/app.config';
import { cn } from '@/lib/utils';
import { CalendarSurfaceHeader } from './CalendarSurfaceHeader';
import { LensTabs, type LensTabDef } from './LensTabs';
import { CalendarToolbar } from './CalendarToolbar';
import { PeriodNavigator } from './PeriodNavigator';
import { MonthLens } from './MonthLens';
import { AgendaLens, type AgendaAction } from './AgendaLens';
import { OffersLens } from './OffersLens';
import { AllDatesLens } from './AllDatesLens';
import { DayRail, type DayRailLegendItem, type DayRailStat } from './DayRail';

/**
 * Phase-1 lens sets (spec §2): producer gets Month + Agenda, artist gets
 * Offers + Month + All dates. The later-phase producer lenses (Needs you /
 * Week / Season) are intentionally not wired here — `LensTabs` renders
 * whatever list it's given, so a later wave only needs to extend these
 * arrays and this component's per-lens `activeLens === '<key>'` branches.
 */
const PRODUCER_LENSES: LensTabDef[] = [
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];
const ARTIST_LENSES: LensTabDef[] = [
  { key: 'offers', label: 'Offers' },
  { key: 'month', label: 'Month' },
  { key: 'all-dates', label: 'All dates' },
];

const PRODUCER_STATUS_ORDER: ProducerStatus[] = [
  'fully_filled',
  'partially_filled',
  'open',
  'cancelled',
  'unconfigured',
];
const PRODUCER_LEGEND: DayRailLegendItem[] = PRODUCER_STATUS_ORDER.map((status) => ({
  label: PRODUCER_TONES[status].label,
  badgeClass: PRODUCER_TONES[status].badgeClass,
  railClass: PRODUCER_TONES[status].railClass,
}));

const ARTIST_STATUS_ORDER: ArtistStatus[] = ['confirmed', 'soft_booked', 'suggested', 'blocked', 'unanswered'];
const ARTIST_LEGEND: DayRailLegendItem[] = ARTIST_STATUS_ORDER.map((status) => ({
  label: ARTIST_TONES[status].label,
  badgeClass: ARTIST_TONES[status].badgeClass,
  railClass: ARTIST_TONES[status].railClass,
}));

export interface CalendarSurfaceActions {
  // Producer actions — all keyed by the show_date id (`ProducerDateEntry.id`),
  // mirroring `ShowsBookingsPage`'s `openShowDate`/`draftHireOrderForDate`/
  // `confirmPeek` (task 16), which all take a plain `dateId: string`.
  confirmHolds?: (dateId: string) => void;
  generateHireOrder?: (dateId: string) => void;
  openDate?: (dateId: string) => void;
  openCasting?: (dateId: string) => void;
  // Artist actions.
  accept?: (bookingId: string) => void;
  decline?: (bookingId: string) => void;
  block?: (dateId: string, date: Date) => void;
}

interface CalendarSurfaceProps {
  role: 'producer' | 'artist';
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  actions: CalendarSurfaceActions;
  /** Controlled active lens key — the caller maps this to `?lens=`. An
   *  unrecognised value (wrong role's key, stale deep link) falls back to
   *  the role's Phase-1 default rather than rendering nothing. */
  lens: string;
  onLensChange: (key: string) => void;
  /** Header copy — the caller (page) owns these; minimal role-based
   *  defaults are used when omitted so the surface still renders standalone
   *  (e.g. in isolation tests). */
  eyebrow?: string;
  eyebrowTone?: Tone;
  title?: string;
  cta?: ReactNode;
  /** Override for "today", so tests get deterministic anchor/selection. */
  today?: Date;
  className?: string;
}

function entriesForDay<T extends { date: Date }>(entries: T[], day: Date): T[] {
  const key = toDateKey(day);
  return entries.filter((e) => toDateKey(e.date) === key);
}

function producerStats(entries: ProducerDateEntry[], anchor: Date): DayRailStat[] {
  const { start, end } = periodWindow(anchor, 'month');
  const inWindow = entries.filter((e) => e.status !== 'cancelled' && e.date >= start && e.date <= end);
  const confirmed = inWindow.reduce((sum, e) => sum + e.confirmedMain, 0);
  const openSlots = inWindow.reduce((sum, e) => sum + Math.max(0, e.mainSlots - e.confirmedMain), 0);
  return [
    { label: 'Confirmed this month', value: String(confirmed), dotClass: 'bg-success' },
    { label: 'Slots still open', value: String(openSlots), dotClass: 'bg-warning' },
  ];
}

function artistStats(entries: ArtistDateEntry[], anchor: Date): DayRailStat[] {
  const { start, end } = periodWindow(anchor, 'month');
  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);
  const offers = inWindow.filter((e) => e.myStatus === 'suggested').length;
  const holds = inWindow.filter((e) => e.myStatus === 'soft_booked').length;
  return [
    { label: 'Open offers', value: String(offers), dotClass: 'bg-primary' },
    { label: 'Holds', value: String(holds), dotClass: 'bg-warning' },
  ];
}

/**
 * The calendar surface orchestrator: composes the shell (header + lens tabs
 * + toolbar/period-nav) with the active Phase-1 lens body and, for the Month
 * lens only, the `DayRail` (spec §5 rail rules — Agenda/All dates run full
 * width, Offers carries its own side content). Owns `{ anchor, selectedDay }`
 * locally; `lens` is fully controlled by the caller. All lens callbacks are
 * wired to `actions` here — the lenses themselves stay presentational.
 */
export function CalendarSurface({
  role,
  producerEntries = [],
  artistEntries = [],
  actions,
  lens,
  onLensChange,
  eyebrow,
  eyebrowTone = 'accent',
  title,
  cta,
  today,
  className,
}: CalendarSurfaceProps) {
  const now = today ?? new Date();
  const [anchor, setAnchor] = useState<Date>(now);
  const [selectedDay, setSelectedDay] = useState<Date>(now);

  const lenses = role === 'producer' ? PRODUCER_LENSES : ARTIST_LENSES;
  const defaultLensKey = role === 'producer' ? 'month' : 'offers';
  const activeLens = lenses.some((l) => l.key === lens) ? lens : defaultLensKey;

  const resolvedEyebrow = eyebrow ?? (role === 'producer' ? 'BOOKINGS' : 'AVAILABILITY');
  const resolvedTitle = title ?? (role === 'producer' ? 'Shows & bookings' : 'Your calendar');

  const dayProducerEntries = entriesForDay(producerEntries, selectedDay);
  const dayArtistEntries = entriesForDay(artistEntries, selectedDay);

  const handleOpenDay = (day: Date) => {
    if (role === 'producer') {
      const entry = entriesForDay(producerEntries, day)[0];
      if (entry) actions.openDate?.(entry.id);
      return;
    }
    // Artists have no "open date" surface in Phase 1 — selecting is opening.
    setSelectedDay(day);
  };

  const handleAgendaAction = (entry: ProducerDateEntry, kind: AgendaAction) => {
    if (kind === 'confirm') actions.confirmHolds?.(entry.id);
    else if (kind === 'generate') actions.generateHireOrder?.(entry.id);
    else actions.openCasting?.(entry.id);
  };

  const handleRailPrimary = () => {
    if (role === 'producer') {
      const withAccepted = dayProducerEntries.find((e) => e.acceptedMain > 0);
      if (withAccepted) {
        actions.confirmHolds?.(withAccepted.id);
        return;
      }
      const filled = dayProducerEntries.find((e) => e.status === 'fully_filled');
      if (filled) actions.generateHireOrder?.(filled.id);
      return;
    }
    const suggested = dayArtistEntries.find((e) => e.myStatus === 'suggested');
    if (suggested?.bookingId) {
      actions.accept?.(suggested.bookingId);
      return;
    }
    const unanswered = dayArtistEntries.find((e) => e.myStatus === 'unanswered');
    if (unanswered) actions.block?.(unanswered.id, unanswered.date);
  };

  const handleRailSecondary = () => {
    if (role === 'producer') {
      const entry = dayProducerEntries[0];
      if (entry) actions.openDate?.(entry.id);
    }
    // Artist secondary defaults to "Message producer" — inert stub for now,
    // there is no wired action for it yet.
  };

  const hireOrderHref = (id: string) => ROUTES.HIRE_ORDER_DETAIL.replace(':id', id);

  // No timestamp exists on ArtistDateEntry to reconstruct "answered today"
  // from data alone — Phase-1 default is empty until a page wires real
  // same-session response history through (task 17).
  // "Later this month" (design copy) is bound to `now`'s month, not the
  // navigable `anchor` — it's a fixed near-term nudge, not a browsable list.
  const notOfferedWindow = periodWindow(now, 'month');
  const notOfferedYet = artistEntries.filter(
    (e) =>
      e.myStatus === 'unanswered' &&
      !isPastDate(e.date, now) &&
      e.date >= notOfferedWindow.start &&
      e.date <= notOfferedWindow.end
  );

  const agendaEntries = (() => {
    const { start, end } = periodWindow(anchor, 'month');
    return producerEntries.filter((e) => e.date >= start && e.date <= end);
  })();

  return (
    <div data-testid="calendar-surface" className={cn('flex flex-col gap-4', className)}>
      <CalendarSurfaceHeader eyebrow={resolvedEyebrow} eyebrowTone={eyebrowTone} title={resolvedTitle} cta={cta}>
        <LensTabs lenses={lenses} active={activeLens} onChange={onLensChange} />
      </CalendarSurfaceHeader>

      {(activeLens === 'month' || activeLens === 'agenda') && (
        <CalendarToolbar>
          <PeriodNavigator
            label={periodLabel(anchor, 'month')}
            onPrev={() => setAnchor((a) => shiftPeriod(a, 'month', -1))}
            onNext={() => setAnchor((a) => shiftPeriod(a, 'month', 1))}
            onToday={() => {
              setAnchor(now);
              setSelectedDay(now);
            }}
          />
        </CalendarToolbar>
      )}

      {activeLens === 'month' ? (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <MonthLens
              role={role}
              anchor={anchor}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onOpenDay={handleOpenDay}
              producerEntries={producerEntries}
              artistEntries={artistEntries}
              today={now}
            />
          </div>
          <DayRail
            role={role}
            day={selectedDay}
            producerEntries={dayProducerEntries}
            artistEntries={dayArtistEntries}
            stats={role === 'producer' ? producerStats(producerEntries, anchor) : artistStats(artistEntries, anchor)}
            legend={role === 'producer' ? PRODUCER_LEGEND : ARTIST_LEGEND}
            onPrimary={handleRailPrimary}
            onSecondary={handleRailSecondary}
            className="w-[280px] shrink-0"
          />
        </div>
      ) : (
        <div className="w-full">
          {activeLens === 'agenda' && (
            <AgendaLens entries={agendaEntries} onOpenDay={handleOpenDay} onAction={handleAgendaAction} />
          )}
          {activeLens === 'offers' && (
            <OffersLens
              entries={artistEntries}
              onAccept={(bookingId) => actions.accept?.(bookingId)}
              onDecline={(bookingId) => actions.decline?.(bookingId)}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              answeredToday={[]}
              notOfferedYet={notOfferedYet}
              today={now}
            />
          )}
          {activeLens === 'all-dates' && (
            <AllDatesLens
              entries={artistEntries}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              hireOrderHref={hireOrderHref}
              today={now}
            />
          )}
        </div>
      )}
    </div>
  );
}
