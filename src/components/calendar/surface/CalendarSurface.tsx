import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format } from 'date-fns';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type {
  ActionGate,
  ActionGates,
  ArtistDateEntry,
  ArtistStatus,
  ProducerDateEntry,
  ProducerStatus,
  Tone,
} from '@/lib/calendar/types';
import { PRODUCER_TONES, ARTIST_TONES } from '@/lib/calendar/tone';
import { periodLabel, periodWindow, shiftPeriod, type LensPeriod } from '@/lib/calendar/period';
import { unconfirmedSlots } from '@/lib/calendar/slots';
import { resolveProducerPrimary } from '@/lib/calendar/producerPrimary';
import { clearSelection, extendTo, selectedKeys, type RangeSelection } from '@/lib/calendar/selection';
import { dfLocale, isPastDate, toDateKey } from '@/lib/dates';
import { computeDatePeek } from '@/lib/bookingCockpit';
import { ROUTES } from '@/config/app.config';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { RowPeek } from '@/components/bookings/RowPeek';
import { CalendarSurfaceHeader } from './CalendarSurfaceHeader';
import { LensTabs, type LensTabDef } from './LensTabs';
import { CalendarToolbar } from './CalendarToolbar';
import { PeriodNavigator } from './PeriodNavigator';
import { MonthLens } from './MonthLens';
import { WeekLens } from './WeekLens';
import { SeasonLens } from './SeasonLens';
import { AgendaLens, type AgendaAction } from './AgendaLens';
import { OffersLens } from './OffersLens';
import { AllDatesLens } from './AllDatesLens';
import { DayRail, type DayRailLegendItem, type DayRailStat } from './DayRail';
import { NeedsYouLens, type NeedsYouAction } from './NeedsYouLens';
import { QueueRail, type QueueShortlistArtist } from './QueueRail';
import { SelectionBar, type SelectionBarAction } from './SelectionBar';
import { CalendarDaySheet } from './CalendarDaySheet';
import { SurfaceFab } from './SurfaceFab';
import { SeasonStripMobile } from './SeasonStripMobile';
import type { NeedsYouGroupKey, NeedsYouItem, NeedsYouQueue } from '@/lib/calendar/needsYou';

/** Bound to the surface's three copy namespaces: producer chrome/status/stats
 *  (`bookings`), artist chrome/status/stats (`availability`), and role-agnostic
 *  bits handled by the shared components (`common`). */
type SurfaceTF = TFunction<['bookings', 'availability', 'common']>;

/**
 * Producer lens set (spec §2/§4): Needs you (first and default — spec §3),
 * Month, Week, Season, Agenda. Artist gets Offers + Month + All dates.
 * `LensTabs` renders whatever list it's given, so this function is the only
 * place the producer tab order/membership is defined.
 */
function producerLenses(needsYouQueue: NeedsYouQueue | undefined, t: SurfaceTF): LensTabDef[] {
  return [
    { key: 'needs-you', label: t('calendar.lens.needsYou'), count: needsYouQueue?.totalItems },
    { key: 'month', label: t('calendar.lens.month') },
    { key: 'week', label: t('calendar.lens.week') },
    { key: 'season', label: t('calendar.lens.season') },
    { key: 'agenda', label: t('calendar.lens.agenda') },
  ];
}
function artistLenses(t: SurfaceTF): LensTabDef[] {
  return [
    { key: 'offers', label: t('availability:calendar.lens.offers') },
    { key: 'month', label: t('availability:calendar.lens.month') },
    { key: 'all-dates', label: t('availability:calendar.lens.allDates') },
  ];
}

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
function producerLegend(t: SurfaceTF): DayRailLegendItem[] {
  return PRODUCER_STATUS_ORDER.map((status) => ({
    label: t(`calendar.producerStatus.${status}`),
    badgeClass: PRODUCER_TONES[status].badgeClass,
    railClass: PRODUCER_TONES[status].railClass,
  }));
}

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
  /** Date ids ready to issue a hire order, threaded straight to `SeasonLens`'s
   *  KPI computation. Ignored for `role="artist"` and outside the Season
   *  lens. Default: empty (no dates flagged ready). */
  seasonReadyIds?: Set<string>;
  /** Bulk actions for the range-selection `SelectionBar` (spec §6, Phase 4).
   *  Ignored for `role="artist"`; the bar itself only renders for the
   *  producer Month and Season lenses, which share the same `range` state
   *  (selection is by day-key, not by lens). Receives the show_date ids for
   *  every selected date that maps to a real `ProducerDateEntry` — a
   *  selected key with no entry is silently dropped, never passed through
   *  as `undefined`/`null`. */
  onBulkConfirm?: (dateIds: string[]) => void;
  onBulkGenerate?: (dateIds: string[]) => void;
  /** Capability gates for the SelectionBar's Confirm/Generate buttons —
   *  same disabled+title contract as `actionGates`, but keyed by the bulk
   *  action instead of the per-date `ProducerActionKey`. Default: no gates,
   *  both buttons enabled. */
  bulkGates?: { confirm?: ActionGate; generate?: ActionGate };
  /** Fired by the mobile `SurfaceFab` ("New date"), shown only for
   *  `role="producer"` on the producer landing lens (Needs you). Optional —
   *  the FAB still renders without it (its click becomes a no-op) so callers
   *  can wire it up in a later task. Ignored entirely on desktop. */
  onNewDate?: () => void;
  className?: string;
}

function entriesForDay<T extends { date: Date }>(entries: T[], day: Date): T[] {
  const key = toDateKey(day);
  return entries.filter((e) => toDateKey(e.date) === key);
}

function producerStats(entries: ProducerDateEntry[], anchor: Date, t: SurfaceTF): DayRailStat[] {
  const { start, end } = periodWindow(anchor, 'month');
  const inWindow = entries.filter((e) => e.status !== 'cancelled' && e.date >= start && e.date <= end);
  const confirmed = inWindow.reduce((sum, e) => sum + e.confirmedMain, 0);
  const openSlots = inWindow.reduce((sum, e) => sum + unconfirmedSlots(e), 0);
  return [
    { label: t('calendar.stat.confirmedThisMonth'), value: String(confirmed), dotClass: 'bg-success' },
    { label: t('calendar.stat.slotsStillOpen'), value: String(openSlots), dotClass: 'bg-warning' },
  ];
}

function artistStats(entries: ArtistDateEntry[], anchor: Date, t: SurfaceTF): DayRailStat[] {
  const { start, end } = periodWindow(anchor, 'month');
  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);
  const offers = inWindow.filter((e) => e.myStatus === 'suggested').length;
  const holds = inWindow.filter((e) => e.myStatus === 'soft_booked').length;
  return [
    { label: t('availability:calendar.stat.openOffers'), value: String(offers), dotClass: 'bg-primary' },
    { label: t('availability:calendar.stat.holds'), value: String(holds), dotClass: 'bg-warning' },
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
  seasonReadyIds = new Set(),
  onBulkConfirm,
  onBulkGenerate,
  bulkGates,
  onNewDate,
  className,
}: CalendarSurfaceProps) {
  const isMobile = useIsMobile();
  const now = useMemo(() => today ?? new Date(), [today]);
  const [anchor, setAnchor] = useState<Date>(now);
  const [selectedDay, setSelectedDay] = useState<Date>(now);
  const [range, setRange] = useState<RangeSelection | null>(null);
  // Mobile-only: whether the `CalendarDaySheet` bottom sheet is open. Kept
  // separate from `selectedDay` (which desktop's DayRail always needs as a
  // non-null `Date`) so the desktop return below stays byte-identical — a
  // day/row/cell tap on mobile relocates `selectedDay` (same as desktop) AND
  // opens this sheet, instead of updating a side rail.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // Space-peek popover (producer-only, Month lens) — `MonthGrid`'s Space key
  // forwards here via `MonthLens.onPeekDay`, wired only for `role==="producer"`
  // below so an artist Space press is never routed into this state at all.
  const [peekDay, setPeekDay] = useState<Date | null>(null);
  const { t: tBooking } = useTranslation('bookingCopy');
  const { t } = useTranslation(['bookings', 'availability', 'common']);

  const resolvedNeedsYouQueue = needsYouQueue ?? EMPTY_NEEDS_YOU_QUEUE;
  const lenses = role === 'producer' ? producerLenses(needsYouQueue, t) : artistLenses(t);
  const defaultLensKey = role === 'producer' ? 'needs-you' : 'offers';
  const activeLens = lenses.some((l) => l.key === lens) ? lens : defaultLensKey;
  const activePeriod: LensPeriod =
    activeLens === 'week' ? 'week' : activeLens === 'season' ? 'season' : 'month';

  const resolvedEyebrow =
    eyebrow ?? (role === 'producer' ? t('calendar.header.eyebrow') : t('availability:calendar.header.eyebrow'));
  const resolvedTitle =
    title ?? (role === 'producer' ? t('calendar.header.title') : t('availability:calendar.header.title'));

  // Complete, localized artist status-label map: the caller's flow-aware
  // overrides (e.g. a direct-booking org's `bookingStatusLabels(flow)` wording)
  // win where present, and every remaining status — notably `blocked`, which
  // has no flow-aware variant — falls back to the localized `artistStatus.*`
  // copy rather than `ARTIST_TONES`' fixed English label. Threaded to every
  // artist child so a status label is never left in English in German.
  // Producer children ignore `statusLabels`, so skip the lookups for them.
  const resolvedArtistStatusLabels = useMemo(() => {
    const out: Partial<Record<ArtistStatus, string>> = {};
    if (role !== 'artist') return out;
    for (const status of ARTIST_STATUS_ORDER) {
      out[status] = statusLabels?.[status] ?? t(`availability:calendar.artistStatus.${status}`);
    }
    return out;
  }, [role, statusLabels, t]);

  // Range selection is producer-only (spec §6) and scoped to one lens view —
  // stale highlighted cells/bar surviving a lens switch would be confusing,
  // so drop the selection whenever the caller navigates to a different lens.
  useEffect(() => {
    setRange(null);
  }, [lens]);

  // Every producer entry id for a given date key, in entry order — a day can
  // hold more than one entry (two shows on the same day; the Season lens
  // renders one row per show), so this must fan out to every entry on that
  // day rather than keep only the last one written.
  const producerEntryIdByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    producerEntries.forEach((entry) => {
      const key = toDateKey(entry.date);
      const ids = map.get(key);
      if (ids) ids.push(entry.id);
      else map.set(key, [entry.id]);
    });
    return map;
  }, [producerEntries]);
  // Every selected date key's entry ids, in range order — a key with no
  // entry (an empty day inside the drag span) contributes nothing, and a key
  // with multiple entries (co-shows sharing a day) contributes all of them,
  // so this is a show_date count, not a day count.
  const selectedDateIds = useMemo(
    () =>
      selectedKeys(range).reduce<string[]>((ids, key) => {
        const entryIds = producerEntryIdByKey.get(key);
        if (entryIds) ids.push(...entryIds);
        return ids;
      }, []),
    [range, producerEntryIdByKey]
  );

  // Referentially stable array of the drag-selected date keys, so the Month
  // and Week lenses can memoize their cell/model derivation on it instead of
  // rebuilding on every parent render. Recomputed only when `range` actually
  // changes (each mouseenter during a drag) — exactly when the highlight moves.
  const producerRangeKeys = useMemo(
    () => (role === 'producer' ? selectedKeys(range) : undefined),
    [role, range]
  );

  // Shared range-selection handlers (Phase 4, producer-only) — one instance
  // wired to both the Month and Season lenses below, since they share the
  // same `range` state (selection is by day-key, not by lens).
  //
  // `handleRangeExtend` is what shift-click relies on: MonthGrid's
  // shift-click path calls `onRangeExtend` directly with no preceding
  // `onRangeStart`/`onSelectDay`, so when there's no drag-established
  // `range` yet, the anchor is seeded from `selectedDay` (the last plain
  // click) rather than collapsing into a single-day range at the shift-click
  // target.
  const seedRangeFromSelectedDay = (): RangeSelection | null =>
    selectedDay ? { anchor: toDateKey(selectedDay), focus: toDateKey(selectedDay) } : null;
  const handleRangeStart = (key: string) => setRange({ anchor: key, focus: key });
  const handleRangeExtend = (key: string) => setRange((r) => extendTo(r ?? seedRangeFromSelectedDay(), key));
  const handleRangeCommit = () => {};

  // A plain click both relocates `selectedDay` (existing behavior) and
  // drops any stale range from a prior drag/shift-click — a fresh click
  // starts a new single-day anchor, it doesn't extend an old selection.
  const handleSelectDay = (day: Date) => {
    setSelectedDay(day);
    setRange(null);
  };

  // Mobile equivalent of `handleSelectDay`/`handleOpenDay`: a day/row/cell
  // tap relocates `selectedDay` (so the sheet shows the tapped day's
  // entries, same derivation the desktop rail uses) and opens the sheet —
  // there is no side rail to update on mobile.
  const handleMobileDayTap = (day: Date) => {
    setSelectedDay(day);
    setRange(null);
    setMobileSheetOpen(true);
  };

  const dayProducerEntries = entriesForDay(producerEntries, selectedDay);
  const dayArtistEntries = entriesForDay(artistEntries, selectedDay);

  // Adapts a `ProducerDateEntry`'s counts to `computeDatePeek`'s `counts`/`slots`
  // shape — there's no `acceptedUs` on the entry (understudy acceptance isn't
  // tracked at the calendar-entry level), so it's passed as 0.
  const peekEntry = role === 'producer' && peekDay ? entriesForDay(producerEntries, peekDay)[0] : undefined;
  const peek = useMemo(
    () =>
      peekEntry
        ? computeDatePeek({
            counts: {
              confirmedMain: peekEntry.confirmedMain,
              confirmedUs: peekEntry.confirmedUs,
              acceptedMain: peekEntry.acceptedMain,
              acceptedUs: 0,
            },
            slots: { main_cast: peekEntry.mainSlots, understudies: peekEntry.understudySlots },
            t: tBooking,
          })
        : null,
    [peekEntry, tBooking]
  );
  const peekOpen = role === 'producer' && peekDay !== null;
  const canConfirmPeek = !actionGates?.confirmHolds?.disabled;

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

  // Mobile `CalendarDaySheet`'s dedicated "Open date" text button — shown
  // for both roles (unlike the desktop rail's secondary, which only wires
  // "Open date" for the producer; the artist has no open-date surface in
  // Phase 1). `actions.openDate` is keyed by show_date id, and both
  // `ProducerDateEntry.id`/`ArtistDateEntry.id` are that same id (see
  // `handleRailPrimary`'s `unanswered.id` usage above), so this resolves
  // identically for either role.
  const handleSheetOpenDate = () => {
    const entry = role === 'producer' ? dayProducerEntries[0] : dayArtistEntries[0];
    if (entry) actions.openDate?.(entry.id);
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

  // Mobile-only: the Week lens collapses to the Agenda day-list (spec §5)
  // filtered to just this week's window, rather than the desktop time grid.
  const weekEntries = (() => {
    const { start, end } = periodWindow(anchor, 'week');
    return producerEntries.filter((e) => e.date >= start && e.date <= end);
  })();

  // Legend labels honor the same flow-aware override as the lenses/rail so the
  // color key never disagrees with the labels it explains.
  const artistLegend: DayRailLegendItem[] = useMemo(
    () =>
      ARTIST_STATUS_ORDER.map((status) => ({
        label: resolvedArtistStatusLabels[status] ?? '',
        badgeClass: ARTIST_TONES[status].badgeClass,
        railClass: ARTIST_TONES[status].railClass,
      })),
    [resolvedArtistStatusLabels],
  );
  // Memoized to match `artistLegend` — otherwise the inline call would rebuild
  // this 5-item array (and hand `DayRail` a fresh identity) on every render,
  // e.g. each mouseenter during a producer range-select drag.
  const producerLegendItems = useMemo(() => producerLegend(t), [t]);

  const bulkActions: SelectionBarAction[] = [
    {
      key: 'confirm',
      label: t('calendar.bulk.confirmHolds'),
      disabled: bulkGates?.confirm?.disabled,
      title: bulkGates?.confirm?.title,
    },
    {
      key: 'generate',
      label: t('calendar.bulk.generateHireOrders'),
      disabled: bulkGates?.generate?.disabled,
      title: bulkGates?.generate?.title,
    },
  ];

  if (!isMobile) {
  return (
    <div data-testid="calendar-surface" className={cn('flex flex-col gap-4', className)}>
      <CalendarSurfaceHeader eyebrow={resolvedEyebrow} eyebrowTone={eyebrowTone} title={resolvedTitle} cta={cta}>
        <LensTabs lenses={lenses} active={activeLens} onChange={onLensChange} />
      </CalendarSurfaceHeader>

      {(activeLens === 'month' || activeLens === 'week' || activeLens === 'season' || activeLens === 'agenda') && (
        <CalendarToolbar>
          <PeriodNavigator
            label={periodLabel(anchor, activePeriod)}
            onPrev={() => setAnchor((a) => shiftPeriod(a, activePeriod, -1))}
            onNext={() => setAnchor((a) => shiftPeriod(a, activePeriod, 1))}
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
          <Popover open={peekOpen} onOpenChange={(open) => { if (!open) setPeekDay(null); }}>
            <PopoverPrimitive.Anchor asChild>
              <div className="min-w-0 flex-1">
                <MonthLens
                  role={role}
                  anchor={anchor}
                  selectedDay={selectedDay}
                  onSelectDay={handleSelectDay}
                  onOpenDay={handleOpenDay}
                  onPeekDay={role === 'producer' ? setPeekDay : undefined}
                  producerEntries={producerEntries}
                  artistEntries={artistEntries}
                  today={now}
                  rangeKeys={producerRangeKeys}
                  onRangeStart={role === 'producer' ? handleRangeStart : undefined}
                  onRangeExtend={role === 'producer' ? handleRangeExtend : undefined}
                  onRangeCommit={role === 'producer' ? handleRangeCommit : undefined}
                  rangeActive={role === 'producer' ? range !== null : undefined}
                />
              </div>
            </PopoverPrimitive.Anchor>
            <PopoverContent
              align="start"
              className="w-auto border-none bg-transparent p-0 shadow-none"
              data-testid="date-peek-popover"
            >
              {peekEntry && (
                <div className="rounded-[var(--radius-l)] border border-border bg-[var(--surface)] shadow-elev3">
                  <RowPeek
                    dateLabel={format(peekEntry.date, 'EEE d MMM', { locale: dfLocale() })}
                    peek={peek}
                    canConfirm={canConfirmPeek}
                    confirming={false}
                    onConfirm={() => actions.confirmHolds?.(peekEntry.id)}
                    onOpen={() => actions.openDate?.(peekEntry.id)}
                  />
                </div>
              )}
            </PopoverContent>
          </Popover>
          <DayRail
            role={role}
            day={selectedDay}
            producerEntries={dayProducerEntries}
            artistEntries={dayArtistEntries}
            stats={role === 'producer' ? producerStats(producerEntries, anchor, t) : artistStats(artistEntries, anchor, t)}
            legend={role === 'producer' ? producerLegendItems : artistLegend}
            onPrimary={handleRailPrimary}
            onSecondary={handleRailSecondary}
            statusLabels={resolvedArtistStatusLabels}
            actionGates={actionGates}
            className="w-[280px] shrink-0"
          />
        </div>
      ) : (
        <div className="w-full">
          {activeLens === 'week' && (
            <WeekLens
              entries={producerEntries}
              anchor={anchor}
              onOpenEntry={(entryId) => actions.openDate?.(entryId)}
              today={now}
            />
          )}
          {activeLens === 'season' && (
            <SeasonLens
              entries={producerEntries}
              anchor={anchor}
              readyIds={seasonReadyIds}
              onOpenDate={(dateId) => actions.openDate?.(dateId)}
              rangeKeys={producerRangeKeys}
              onRangeStart={role === 'producer' ? handleRangeStart : undefined}
              onRangeExtend={role === 'producer' ? handleRangeExtend : undefined}
              onRangeCommit={role === 'producer' ? handleRangeCommit : undefined}
            />
          )}
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
              statusLabels={resolvedArtistStatusLabels}
              today={now}
            />
          )}
          {activeLens === 'all-dates' && (
            <AllDatesLens
              entries={artistEntries}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              hireOrderHref={hireOrderHref}
              statusLabels={resolvedArtistStatusLabels}
              today={now}
            />
          )}
        </div>
      )}

      {role === 'producer' && (activeLens === 'month' || activeLens === 'season') && (
        <SelectionBar
          count={selectedDateIds.length}
          actions={bulkActions}
          onAction={(key) => (key === 'confirm' ? onBulkConfirm?.(selectedDateIds) : onBulkGenerate?.(selectedDateIds))}
          onClear={() => setRange(clearSelection())}
        />
      )}
    </div>
  );
  }

  // --- Mobile shell (spec §5, Phase 5) ---------------------------------
  // Single-column layout: compact header with a scrollable `LensTabs`, a
  // full-width period bar for the lenses that have one (month/week/season —
  // NOT needs-you/agenda/offers/all-dates, unlike desktop which also shows
  // it for agenda), the active lens body with no side rail, the
  // `CalendarDaySheet` bottom sheet (replacing the desktop `DayRail`), and a
  // `SurfaceFab` for the producer landing lens only. Offers/Agenda/Needs-you
  // reflow to single column via responsive classes on those components
  // (Task 8; Needs-you also gets `layout="stacked"` to fold `QueueRail`
  // below the groups instead of composing it as a side rail here). Month
  // renders the dense `MonthGrid` variant; Week collapses to the Agenda
  // day-list filtered to the week window instead of the desktop time grid;
  // Season swaps the desktop heatmap for `SeasonStripMobile`; All dates
  // reflows to stacked rows via responsive classes on `AllDatesLens` itself
  // (Task 9).
  return (
    <div data-testid="calendar-surface" className={cn('flex flex-col gap-4', className)}>
      <CalendarSurfaceHeader eyebrow={resolvedEyebrow} eyebrowTone={eyebrowTone} title={resolvedTitle} cta={cta}>
        <LensTabs lenses={lenses} active={activeLens} onChange={onLensChange} scrollable />
      </CalendarSurfaceHeader>

      {(activeLens === 'month' || activeLens === 'week' || activeLens === 'season') && (
        <CalendarToolbar>
          <PeriodNavigator
            label={periodLabel(anchor, activePeriod)}
            onPrev={() => setAnchor((a) => shiftPeriod(a, activePeriod, -1))}
            onNext={() => setAnchor((a) => shiftPeriod(a, activePeriod, 1))}
            onToday={() => {
              setAnchor(now);
              setSelectedDay(now);
            }}
          />
        </CalendarToolbar>
      )}

      {activeLens === 'needs-you' ? (
        <NeedsYouLens
          queue={resolvedNeedsYouQueue}
          onItemAction={handleNeedsYouAction}
          onOpenDate={(dateId) => actions.openDate?.(dateId)}
          onBulk={handleNeedsYouBulk}
          receipts={clearedToday}
          onUndoLast={onUndoLastReceipt}
          actionGates={actionGates}
          layout="stacked"
          queueShortlist={queueShortlist}
          onOfferArtist={(dateId, artistId) => actions.offerArtist?.(dateId, artistId)}
        />
      ) : activeLens === 'month' ? (
        <MonthLens
          role={role}
          anchor={anchor}
          selectedDay={selectedDay}
          onSelectDay={handleMobileDayTap}
          onOpenDay={handleMobileDayTap}
          producerEntries={producerEntries}
          artistEntries={artistEntries}
          today={now}
          dense
        />
      ) : (
        <div className="w-full">
          {activeLens === 'week' && (
            // Mobile "Week" collapses to the Agenda day-list (spec §5),
            // filtered down to just this week's window — NOT the desktop
            // time-grid `WeekLens` above. A row tap opens the day sheet, same
            // pattern as the mobile Agenda lens below (not the desktop
            // "navigate straight to the date" behavior).
            <AgendaLens
              entries={weekEntries}
              onOpenEntry={(entry) => handleMobileDayTap(entry.date)}
              onAction={handleAgendaAction}
              actionGates={actionGates}
            />
          )}
          {activeLens === 'season' && (
            <SeasonStripMobile
              entries={producerEntries}
              anchor={anchor}
              readyIds={seasonReadyIds}
              onOpenDate={(dateId) => {
                const entry = producerEntries.find((e) => e.id === dateId);
                if (entry) handleMobileDayTap(entry.date);
              }}
            />
          )}
          {activeLens === 'agenda' && (
            <AgendaLens
              entries={agendaEntries}
              // Mobile has no side rail: a row tap opens the day sheet for
              // that row's date (spec §4.5/§4.7), same as a Month cell tap —
              // NOT the desktop behavior of navigating straight to the date
              // (see the desktop branch above, unchanged).
              onOpenEntry={(entry) => handleMobileDayTap(entry.date)}
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
              statusLabels={resolvedArtistStatusLabels}
              today={now}
            />
          )}
          {activeLens === 'all-dates' && (
            <AllDatesLens
              entries={artistEntries}
              onBlock={(dateId, date) => actions.block?.(dateId, date)}
              hireOrderHref={hireOrderHref}
              statusLabels={resolvedArtistStatusLabels}
              today={now}
            />
          )}
        </div>
      )}

      <CalendarDaySheet
        open={mobileSheetOpen}
        onOpenChange={(open) => setMobileSheetOpen(open)}
        role={role}
        day={selectedDay}
        producerEntries={dayProducerEntries}
        artistEntries={dayArtistEntries}
        onPrimary={handleRailPrimary}
        onOpenDate={handleSheetOpenDate}
        // "Message producer" has no wired action yet — same inert stub as
        // the desktop rail's artist secondary (`handleRailSecondary`); the
        // sheet's button simply no-ops on click until one exists.
        statusLabels={resolvedArtistStatusLabels}
        actionGates={actionGates}
      />

      {role === 'producer' && activeLens === 'needs-you' && (
        <SurfaceFab label={t('calendar.fab.newDate')} onClick={() => onNewDate?.()} />
      )}
    </div>
  );
}
