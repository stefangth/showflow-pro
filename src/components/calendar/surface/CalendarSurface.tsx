import { useMemo, useState, type ReactNode } from 'react';
import type {
  ActionGates,
  ArtistDateEntry,
  ArtistStatus,
  ProducerDateEntry,
  ProducerStatus,
  Tone,
} from '@/lib/calendar/types';
import { PRODUCER_TONES, ARTIST_TONES, artistStatusLabel } from '@/lib/calendar/tone';
import { periodLabel, periodWindow, shiftPeriod } from '@/lib/calendar/period';
import { resolveProducerPrimary } from '@/lib/calendar/producerPrimary';
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
import { NeedsYouLens, type NeedsYouAction } from './NeedsYouLens';
import { QueueRail, type QueueShortlistArtist } from './QueueRail';
import type { NeedsYouGroupKey, NeedsYouItem, NeedsYouQueue } from '@/lib/calendar/needsYou';

/**
 * Phase-1/2 lens sets (spec §2): producer gets Needs you + Month + Agenda
 * (Needs you first and default — spec §3), artist gets Offers + Month + All
 * dates. The later-phase producer lenses (Week / Season) are intentionally
 * not wired here — `LensTabs` renders whatever list it's given, so a later
 * wave only needs to extend these arrays and this component's per-lens
 * `activeLens === '<key>'` branches.
 */
function producerLenses(needsYouQueue: NeedsYouQueue | undefined): LensTabDef[] {
  return [
    { key: 'needs-you', label: 'Needs you', count: needsYouQueue?.totalItems },
    { key: 'month', label: 'Month' },
    { key: 'agenda', label: 'Agenda' },
  ];
}
const ARTIST_LENSES: LensTabDef[] = [
  { key: 'offers', label: 'Offers' },
  { key: 'month', label: 'Month' },
  { key: 'all-dates', label: 'All dates' },
];

/** Empty queue shape passed to `NeedsYouLens`/`QueueRail` when the caller
 *  hasn't wired `needsYouQueue` yet (or it's genuinely empty) — the lens
 *  must render gracefully (no groups, zero counts) rather than crash or be
 *  skipped, since it's now the producer default. */
const EMPTY_NEEDS_YOU_QUEUE: NeedsYouQueue = {
  groups: [],
  totalItems: 0,
  countByGroup: { 'expires-today': 0, 'at-risk': 0, 'ready-to-issue': 0, cancelled: 0 },
};

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

export interface CalendarSurfaceActions {
  // Producer actions — all keyed by the show_date id (`ProducerDateEntry.id`),
  // mirroring `ShowsBookingsPage`'s `openShowDate`/`draftHireOrderForDate`/
  // `confirmPeek` (task 16), which all take a plain `dateId: string`.
  confirmHolds?: (dateId: string) => void;
  generateHireOrder?: (dateId: string) => void;
  openDate?: (dateId: string) => void;
  openCasting?: (dateId: string) => void;
  // "Needs you" lens actions (spec §4.1) — all also keyed by the show_date id.
  extendHold?: (dateId: string) => void;
  releaseHold?: (dateId: string) => void;
  notifyCast?: (dateId: string) => void;
  cancelDate?: (dateId: string) => void;
  undoCancel?: (dateId: string) => void;
  previewHireOrder?: (dateId: string) => void;
  offerArtist?: (dateId: string, artistId: string) => void;
  confirmAll?: (dateIds: string[]) => void;
  generateAll?: (dateIds: string[]) => void;
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
  /** Capability gates for the producer action buttons (Confirm holds /
   *  Generate hire order / Open casting) rendered by the DayRail and Agenda
   *  lens. When a button's resolved action is gated `disabled`, it renders
   *  `disabled` with `title` as its tooltip instead of silently no-opping —
   *  the caller (page) still owns whether the underlying `actions` callback
   *  is itself gated; this only controls the button's own affordance.
   *  Ignored for `role="artist"`. Default: no gates, everything enabled. */
  actionGates?: ActionGates;
  /** Controlled active lens key — the caller maps this to `?lens=`. An
   *  unrecognised value (wrong role's key, stale deep link) falls back to
   *  the role's Phase-1 default rather than rendering nothing. */
  lens: string;
  onLensChange: (key: string) => void;
  /** Flow-aware artist status label override (e.g. a direct-booking org's
   *  wording from `bookingStatusLabels(flow)`), threaded to the Offers/All
   *  dates lenses and the artist DayRail. Ignored for `role="producer"`; a
   *  missing key falls back to `ARTIST_TONES`' fixed label (see
   *  `artistStatusLabel`). */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Header copy — the caller (page) owns these; minimal role-based
   *  defaults are used when omitted so the surface still renders standalone
   *  (e.g. in isolation tests). */
  eyebrow?: string;
  eyebrowTone?: Tone;
  title?: string;
  cta?: ReactNode;
  /** Override for "today", so tests get deterministic anchor/selection. */
  today?: Date;
  /** The producer "Needs you" worklist (spec §4.1). Ignored for
   *  `role="artist"`. Absent/empty renders the lens with no groups rather
   *  than skipping it — it's the producer default so it must never crash on
   *  a caller that hasn't wired it up yet. */
  needsYouQueue?: NeedsYouQueue;
  /** Eligible-artist shortlist for the queue's top at-risk date, threaded
   *  straight to `QueueRail`. `null`/omitted hides the shortlist card. */
  queueShortlist?: { dateId: string; dateLabel: string; artists: QueueShortlistArtist[] } | null;
  /** Today's cleared-queue receipts, threaded straight to `NeedsYouLens`'s
   *  footer. Omitted renders an empty receipts list. */
  clearedToday?: { dateId: string; title: string; label: string }[];
  onUndoLastReceipt?: () => void;
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
  actionGates,
  lens,
  onLensChange,
  statusLabels,
  eyebrow,
  eyebrowTone = 'accent',
  title,
  cta,
  today,
  needsYouQueue,
  queueShortlist = null,
  clearedToday = [],
  onUndoLastReceipt,
  className,
}: CalendarSurfaceProps) {
  const now = useMemo(() => today ?? new Date(), [today]);
  const [anchor, setAnchor] = useState<Date>(now);
  const [selectedDay, setSelectedDay] = useState<Date>(now);

  const resolvedNeedsYouQueue = needsYouQueue ?? EMPTY_NEEDS_YOU_QUEUE;
  const lenses = role === 'producer' ? producerLenses(needsYouQueue) : ARTIST_LENSES;
  const defaultLensKey = role === 'producer' ? 'needs-you' : 'offers';
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

  const handleNeedsYouAction = (item: NeedsYouItem, action: NeedsYouAction) => {
    const dateId = item.dateId;
    switch (action) {
      case 'confirm':
        actions.confirmHolds?.(dateId);
        break;
      case 'extend':
        actions.extendHold?.(dateId);
        break;
      case 'release':
        actions.releaseHold?.(dateId);
        break;
      case 'open-casting':
        actions.openCasting?.(dateId);
        break;
      case 'cancel-date':
        actions.cancelDate?.(dateId);
        break;
      case 'generate':
        actions.generateHireOrder?.(dateId);
        break;
      case 'preview':
        actions.previewHireOrder?.(dateId);
        break;
      case 'notify':
        actions.notifyCast?.(dateId);
        break;
      case 'undo-cancel':
        actions.undoCancel?.(dateId);
        break;
    }
  };

  const handleNeedsYouBulk = (group: NeedsYouGroupKey, action: 'confirm' | 'generate') => {
    const groupEntry = resolvedNeedsYouQueue.groups.find((g) => g.key === group);
    const dateIds = groupEntry?.items.map((item) => item.dateId) ?? [];
    if (action === 'confirm') actions.confirmAll?.(dateIds);
    else actions.generateAll?.(dateIds);
  };

  const handleRailPrimary = () => {
    if (role === 'producer') {
      // Same resolution DayRail uses to pick its label/gate — see
      // `resolveProducerPrimary`'s doc comment — so dispatch can never
      // disagree with what the button displayed.
      const resolved = resolveProducerPrimary(dayProducerEntries);
      if (resolved?.kind === 'confirmHolds') {
        actions.confirmHolds?.(resolved.entry.id);
      } else if (resolved?.kind === 'generateHireOrder') {
        actions.generateHireOrder?.(resolved.entry.id);
      }
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

  // Legend labels honor the same flow-aware override as the lenses/rail so the
  // color key never disagrees with the labels it explains.
  const artistLegend: DayRailLegendItem[] = useMemo(
    () =>
      ARTIST_STATUS_ORDER.map((status) => ({
        label: artistStatusLabel(status, statusLabels),
        badgeClass: ARTIST_TONES[status].badgeClass,
        railClass: ARTIST_TONES[status].railClass,
      })),
    [statusLabels],
  );

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

      {activeLens === 'needs-you' ? (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <NeedsYouLens
              queue={resolvedNeedsYouQueue}
              onItemAction={handleNeedsYouAction}
              onOpenDate={(dateId) => actions.openDate?.(dateId)}
              onBulk={handleNeedsYouBulk}
              receipts={clearedToday}
              onUndoLast={onUndoLastReceipt}
              actionGates={actionGates}
            />
          </div>
          <QueueRail
            queue={resolvedNeedsYouQueue}
            clearedToday={clearedToday.length}
            shortlist={queueShortlist}
            onOffer={(dateId, artistId) => actions.offerArtist?.(dateId, artistId)}
            className="w-[280px] shrink-0"
          />
        </div>
      ) : activeLens === 'month' ? (
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
            legend={role === 'producer' ? PRODUCER_LEGEND : artistLegend}
            onPrimary={handleRailPrimary}
            onSecondary={handleRailSecondary}
            statusLabels={statusLabels}
            actionGates={actionGates}
            className="w-[280px] shrink-0"
          />
        </div>
      ) : (
        <div className="w-full">
          {activeLens === 'agenda' && (
            <AgendaLens
              entries={agendaEntries}
              onOpenEntry={(entry) => actions.openDate?.(entry.id)}
              onAction={handleAgendaAction}
              actionGates={actionGates}
            />
          )}
          {activeLens === 'offers' && (
            <OffersLens
              entries={artistEntries}
              onAccept={(bookingId) => actions.accept?.(bookingId)}
              onDecline={(bookingId) => actions.decline?.(bookingId)}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              answeredToday={[]}
              notOfferedYet={notOfferedYet}
              statusLabels={statusLabels}
              today={now}
            />
          )}
          {activeLens === 'all-dates' && (
            <AllDatesLens
              entries={artistEntries}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              hireOrderHref={hireOrderHref}
              statusLabels={statusLabels}
              today={now}
            />
          )}
        </div>
      )}
    </div>
  );
}
