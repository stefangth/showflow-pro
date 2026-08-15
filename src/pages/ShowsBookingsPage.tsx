import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  bulkConfirmSoftBooked,
  bulkDeclineSoftBooked,
  dryRunOfferTier,
  extendOfferExpiry,
  fetchBookingCountsByDate,
  fetchSoftBookedIdsForDate,
  notifyCast as notifyCastRequest,
  openOfferTier,
} from '@/data/bookings';
import { fetchShowDatesList } from '@/data/showDates';
import { useAuth } from '@/features/auth/AuthContext';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { pagerPosition } from '@/lib/bookingCockpit';
import { Search, ListChecks } from 'lucide-react';
import { parseISO } from 'date-fns';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import type { TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ArtistBookingsView } from '@/components/bookings/ArtistBookingsView';
import { FirstOfferCard } from '@/components/bookings/setup/FirstOfferCard';
import { DashboardSetupRail } from '@/components/dashboard/firstRun/DashboardSetupRail';
import { DashboardWelcomeCollapsed } from '@/components/dashboard/firstRun/DashboardWelcomeCollapsed';
import { useModuleOnboardingRail } from '@/components/setup/useModuleOnboardingRail';
import { SetupChecklistSheet } from '@/components/setup/SetupChecklistSheet';
import type { ComposedStep } from '@/lib/dashboard/types';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';
import type { CockpitTab } from '@/components/shows/date/CockpitHeader';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { NewOrderWizard } from '@/components/hireOrders/NewOrderWizard';
import { HireOrderReadyBanner } from '@/components/hireOrders/HireOrderReadyBanner';
import { useDatesReadyForHireOrder, useHireOrderAction } from '@/hooks/useHireOrders';
import { useFeature, useEntitlements } from '@/hooks/useEntitlements';
import { useCan } from '@/hooks/useCapabilities';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSlots } from '@/lib/settings';
import { formatDateWithWeekday, parseDateOnly } from '@/lib/dates';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { compareCustomValues, customFilterMatches, type CustomFilterState } from '@/lib/customFields';
import { CustomFieldFilter } from '@/components/filters/CustomFieldFilter';
import { emptyCustomFilter } from '@/components/filters/customFilterState';
import { PageMini } from '@/components/minis/PageMini';
import { CalendarSurface } from '@/components/calendar/surface/CalendarSurface';
import { toProducerEntries } from '@/lib/calendar/producerData';
import { buildNeedsYouQueue } from '@/lib/calendar/needsYou';
import { useBookingsWithArtist } from '@/hooks/useBookingsWithArtist';

type ShowRef = {
  id: string;
  program: string | null;
  sub_program: string | null;
  status: 'active' | 'archived' | 'draft';
  main_cast_slots: number | null;
  understudy_slots: number | null;
};

type CityRef = { id: string; name: string } | null;

type ShowDateRow = {
  id: string;
  date: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  status: 'open' | 'partially_filled' | 'fully_filled' | 'cancelled';
  notes: string | null;
  cancellation_reason: string | null;
  city_id: string | null;
  show_id: string;
  custom: Record<string, unknown> | null;
  show: ShowRef;
  city: CityRef;
};

type ShowDateStatus = 'open' | 'partially_filled' | 'fully_filled' | 'cancelled';
/** UI-only status: 'unconfigured' is rendered client-side when the show's (program, sub_program) has no slot config. */
type DisplayStatus = ShowDateStatus | 'unconfigured';

export default function ShowsBookingsPage() {
  const { hasRole } = useAuth();
  // hasRole respects viewAsRole simulation, so an admin viewing-as-artist gets ArtistShowsBookings
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistShowsBookings />;
  }
  return <ProducerShowsBookings />;
}

function ArtistShowsBookings() {
  const bookingOn = useFeature('booking_flow');
  return (
    <div className="space-y-6">
      {bookingOn && <FirstOfferCard />}
      <ArtistBookingsView />
    </div>
  );
}

function ProducerShowsBookings() {
  const { t } = useTranslation('bookings');
  const STATUS_LABEL: Record<DisplayStatus, string> = useMemo(() => ({
    open: t('status.open'),
    partially_filled: t('status.partiallyFilled'),
    fully_filled: t('status.fullyFilled'),
    cancelled: t('status.cancelled'),
    unconfigured: t('status.unconfigured'),
  }), [t]);
  const { canSee } = useFilterVisibility('bookings');
  const { getCustomFieldDefs } = useEditorConfig();
  const customDefs = useMemo(() => getCustomFieldDefs('show_dates'), [getCustomFieldDefs]);
  const filterableDefs = useMemo(() => customDefs.filter(d => d.filterable), [customDefs]);
  const sortableDefs = useMemo(() => customDefs.filter(d => d.sortable), [customDefs]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  // No default bound: the calendar surface's own PeriodNavigator already owns
  // the visible window (Month/Agenda lens), so pre-filtering to "Upcoming"
  // here double-windowed the calendar — navigating to a past/future month
  // showed nothing because this filter had already dropped those dates.
  // `timeframe` still exists for the `?from=/?to=` deep-link effect below.
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
  type ProducerSort = SortValue | `custom:${string}`;
  const [sort, setSort] = useState<ProducerSort>('chrono_asc');
  const isCustomSort = (s: ProducerSort): s is `custom:${string}` => s.startsWith('custom:');
  const sortExtraOptions = sortableDefs.flatMap(d => ([
    { value: `custom:${d.key}:asc` as ProducerSort, label: t('producer.sortAsc', { label: d.label }) },
    { value: `custom:${d.key}:desc` as ProducerSort, label: t('producer.sortDesc', { label: d.label }) },
  ]));
  const [customFilters, setCustomFilters] = useState<Record<string, CustomFilterState>>({});
  const [lens, setLens] = useState<'needs-you' | 'month' | 'agenda'>('needs-you');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);
  // Which tab the sheet should land on for the date about to open — reset on
  // every open so a stale "Open casting" request can't leak into a later
  // plain "Open date" for a different date.
  const [sheetInitialTab, setSheetInitialTab] = useState<CockpitTab | undefined>(undefined);
  const openShowDate = (id: string) => { setSheetInitialTab(undefined); setActiveShowDateId(id); };
  // Agenda lens's "Open casting" action (open-status dates): the label promises
  // casting/offers, so land the sheet on the Offers tab instead of the default Cast tab.
  const openCastingDate = (id: string) => { setSheetInitialTab('offers'); setActiveShowDateId(id); };

  const [newDateOpen, setNewDateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { hasRole, currentOrg } = useAuth();
  const canManage = hasRole('admin') || hasRole('producer');
  const orgId = currentOrg?.id ?? null;
  const bookingOn = useFeature('booking_flow');
  const { features, isLoading: entitlementsLoading } = useEntitlements();
  // The setup rail is a WRITE surface (its Sheet persists app_settings), so it must NOT
  // fail open while entitlements load. `features.has()` alone is not enough: it falls back
  // to registry defaults during the load window, and booking_flow defaults ON, so a booking
  // -off org would briefly mount a live settings-write surface. Gate on !loading AND the
  // resolved entitlement (no super-admin exemption -- app_settings RLS checks role, not
  // entitlement). Mirrors HireOrdersPage's `entitledForWrites`.
  const bookingEntitledForWrites = !entitlementsLoading && features.has('booking_flow');
  // `rail.mode` is one of "banner" (full wizard), "collapsed" (compact bar,
  // re-expandable), "button" (setup complete, permanent header re-entry), or
  // "hidden" (nothing actionable). All four render states below key off this
  // single value, behind the same write-gate as the rail itself.
  const rail = useModuleOnboardingRail('booking_flow', bookingEntitledForWrites ? orgId : null);
  const setupMode = bookingEntitledForWrites ? rail.mode : 'hidden';
  const [setupSheetOpen, setSetupSheetOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<string | undefined>(undefined);
  const openSetupAt = (step: ComposedStep) => { setSetupStep(step.key); setSetupSheetOpen(true); };
  // Hire-order CTA: module gate + generate capability + which dates are ready.
  const hireOrdersOn = useFeature('hire_orders');
  const canGenerateHireOrders = useCan('generate_hire_orders');
  // Calendar surface's Confirm-holds action, gated the same as the sheet's own confirm control.
  const canConfirmBookings = useCan('confirm_bookings');
  const { data: hireOrderReady } = useDatesReadyForHireOrder(hireOrdersOn ? orgId : null);
  const readyCount = hireOrderReady?.readyIds.length ?? 0;
  const hireOrderAction = useHireOrderAction();
  const draftHireOrderForDate = (dateId: string) => {
    if (!orgId) return;
    hireOrderAction.mutate({ action: 'draft', org_id: orgId, show_date_id: dateId, notify: false });
  };
  // Calendar surface action: gated by the same generate-hire-orders capability as the
  // per-date inline CTA used to be. A no-op when the viewer can't generate orders.
  const generateHireOrder = (dateId: string) => {
    if (!canGenerateHireOrders) return;
    draftHireOrderForDate(dateId);
  };

  /** The calendar surface's Confirm-holds action: lazily fetch the date's soft_booked ids,
   *  bulk-confirm them, then invalidate the whole bookings domain (never just the counts
   *  sub-key). Always gives feedback and refreshes, even when the cached count was stale
   *  and no rows remain to confirm. */
  async function confirmHoldsForDate(showDateId: string) {
    try {
      const ids = await fetchSoftBookedIdsForDate(supabase, showDateId);
      const { affected } = ids.length
        ? await bulkConfirmSoftBooked(supabase, { ids, now: new Date() })
        : { affected: 0 };
      toast.success(affected ? t('producer.toast.confirmed', { count: affected }) : t('producer.toast.nothingToConfirm'));
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  // Gated the same as the sheet's own confirm control; a no-op otherwise.
  const confirmHolds = (dateId: string) => {
    if (!(canConfirmBookings && bookingOn)) return;
    void confirmHoldsForDate(dateId);
  };

  useEffect(() => {
    const status = searchParams.get('status');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const lensParam = searchParams.get('lens');
    if (status && ['open', 'partially_filled', 'fully_filled', 'cancelled', 'unconfigured'].includes(status)) {
      setStatusFilter(status as DisplayStatus);
    }
    if (from || to) {
      setTimeframe({ from: from ? parseISO(from) : null, to: to ? parseISO(to) : null });
    }
    if (lensParam === 'needs-you' || lensParam === 'month' || lensParam === 'agenda') {
      setLens(lensParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: invalidate when bookings or show_dates change
  useEffect(() => {
    const channel = supabase
      .channel('shows-bookings-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
        queryClient.invalidateQueries({ queryKey: ['show-dates'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'show_dates' }, () => {
        queryClient.invalidateQueries({ queryKey: ['show-dates'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: bookingCounts } = useQuery({
    queryKey: ['bookings', 'counts-by-date', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchBookingCountsByDate(supabase, currentOrg?.id ?? null),
  });

  const { data: showDates, isLoading } = useQuery({
    queryKey: ['show-dates', 'list', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchShowDatesList<ShowDateRow>(supabase, currentOrg?.id ?? null),
  });

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    showDates?.forEach(sd => sd.show?.program && set.add(sd.show.program));
    return Array.from(set).sort();
  }, [showDates]);

  const displayStatus = (sd: ShowDateRow): DisplayStatus => {
    if (sd.status === 'open' && !showSlots(sd.show)) {
      return 'unconfigured';
    }
    return sd.status;
  };

  const filtered = useMemo(() => {
    if (!showDates) return [];
    let list = showDates.filter(sd => {
      const venue = sd.venue ?? '';
      const cityName = sd.city?.name ?? '';
      const matchSearch = search === '' ||
        sd.show?.program?.toLowerCase().includes(search.toLowerCase()) ||
        sd.show?.sub_program?.toLowerCase().includes(search.toLowerCase()) ||
        venue.toLowerCase().includes(search.toLowerCase()) ||
        cityName.toLowerCase().includes(search.toLowerCase());
      const matchProgram = programs.length === 0 || (sd.show?.program && programs.includes(sd.show.program));
      return matchSearch && matchProgram;
    });
    if (timeframe.from || timeframe.to) {
      list = list.filter(sd => inTimeframe(parseDateOnly(sd.date), timeframe));
    }
    if (statusFilter !== 'all') {
      list = list.filter(sd => displayStatus(sd) === statusFilter);
    }
    for (const def of filterableDefs) {
      const f = customFilters[`custom.${def.key}`];
      if (f) list = list.filter(sd => customFilterMatches(sd.custom?.[def.key], def.type, f));
    }
    if (isCustomSort(sort)) {
      const [, key, dir] = sort.split(':');
      const def = customDefs.find(d => d.key === key);
      if (def) {
        const sign = dir === 'desc' ? -1 : 1;
        return [...list].sort((a, b) => sign * compareCustomValues(a.custom?.[key], b.custom?.[key], def.type));
      }
    }
    return applySort(list, sort as SortValue,
      sd => sd.show?.program ?? '',
      sd => parseDateOnly(sd.date)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDates, search, programs, timeframe, statusFilter, sort, customFilters, filterableDefs, customDefs]);

  const producerEntries = useMemo(
    // hireOrderReady is only fetched when hireOrdersOn (query disabled otherwise, see
    // useDatesReadyForHireOrder above), so orderByDate is naturally undefined when the
    // module is off — nothing changes for orgs without hire_orders.
    () => toProducerEntries(filtered, bookingCounts, hireOrderReady?.orderByDate),
    [filtered, bookingCounts, hireOrderReady]
  );

  // ── "Needs you" queue (calendar surface default lens) ─────────────────────
  // Queue-relevant date ids: every non-cancelled date, plus a cancelled date
  // whose cast hasn't been notified yet — the union `buildNeedsYouQueue` can
  // actually surface. Bounded by the page's own search/status/program filters,
  // same as `producerEntries` itself.
  const needsYouDateIds = useMemo(
    () => producerEntries.filter((e) => e.status !== 'cancelled' || !e.castNotifiedAt).map((e) => e.id),
    [producerEntries]
  );
  const { data: needsYouPeople } = useBookingsWithArtist(orgId, needsYouDateIds);
  const needsYouQueue = useMemo(
    () => buildNeedsYouQueue({
      entries: producerEntries,
      people: needsYouPeople ?? [],
      readyIds: new Set(hireOrderReady?.readyIds ?? []),
      now: new Date(),
    }),
    [producerEntries, needsYouPeople, hireOrderReady]
  );

  // Eligible-artist shortlist for the queue's top at-risk date — threaded to QueueRail.
  const topAtRisk = needsYouQueue.groups.find((g) => g.key === 'at-risk')?.items[0];
  const { data: shortlistResult } = useQuery({
    queryKey: ['bookings', 'shortlist', topAtRisk?.dateId],
    enabled: !!topAtRisk,
    queryFn: () => dryRunOfferTier(supabase, { showDateId: topAtRisk!.dateId, tier: 1 }),
  });
  const queueShortlist = useMemo(() => {
    if (!topAtRisk) return null;
    return {
      dateId: topAtRisk.dateId,
      dateLabel: formatDateWithWeekday(topAtRisk.entry.date),
      artists: (shortlistResult?.candidates ?? []).map((c) => ({ artistId: c.id, name: c.name })),
    };
  }, [topAtRisk, shortlistResult]);

  // "Cleared today" receipts (Needs-you lens footer) — session-local, visual only;
  // "Undo last" pops the most recent entry but does NOT revert the underlying
  // mutation (best-effort visual, per the queue's own design).
  const [clearedToday, setClearedToday] = useState<{ dateId: string; title: string; label: string }[]>([]);
  const addReceipt = (dateId: string, label: string) => {
    const entry = producerEntries.find((e) => e.id === dateId);
    const title = entry ? entry.program + (entry.subProgram ? ` · ${entry.subProgram}` : '') : dateId;
    setClearedToday((prev) => [...prev, { dateId, title, label }]);
  };
  const onUndoLastReceipt = () => setClearedToday((prev) => prev.slice(0, -1));

  const canRunOfferEngine = useCan('run_offer_engine');

  // "Extend 24h" (expires-today secondary) — no gate key on the button itself
  // (NeedsYouLens renders it unconditionally enabled), so the gate lives here.
  const extendHold = (dateId: string) => {
    if (!(canConfirmBookings && bookingOn)) return;
    void extendOfferExpiry(supabase, { showDateId: dateId, hours: 24 })
      .then(({ affected }) => {
        const label = t('needsYou.toast.extended', { count: affected });
        toast.success(label);
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
        if (affected) addReceipt(dateId, label);
      })
      .catch((e) => toast.error((e as Error).message));
  };

  /** "Release" (expires-today secondary): decline the date's still-soft_booked
   *  holds — mirrors confirmHoldsForDate's fetch-then-bulk-write shape. */
  async function releaseHoldForDate(showDateId: string) {
    try {
      const ids = await fetchSoftBookedIdsForDate(supabase, showDateId);
      const { affected } = ids.length
        ? await bulkDeclineSoftBooked(supabase, { ids, now: new Date() })
        : { affected: 0 };
      const label = affected
        ? t('needsYou.toast.released', { count: affected })
        : t('producer.toast.nothingToConfirm');
      toast.success(label);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (affected) addReceipt(showDateId, label);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const releaseHold = (dateId: string) => {
    if (!(canConfirmBookings && bookingOn)) return;
    void releaseHoldForDate(dateId);
  };

  /** "Notify cast" (cancelled group primary): immediate notify-cast invocation,
   *  distinct from the delayed 20:00 confirmation digest. */
  async function notifyCastForDate(showDateId: string) {
    try {
      const { notified } = await notifyCastRequest(supabase, { showDateId });
      const label = t('needsYou.toast.notified', { count: notified });
      toast.success(label);
      queryClient.invalidateQueries({ queryKey: ['show-dates'] });
      addReceipt(showDateId, label);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const notifyCastAction = (dateId: string) => { void notifyCastForDate(dateId); };

  // Cancelling requires a typed reason (captured by the sheet's own Cancel
  // control — see ShowDateDetailSheet); there's no reason-less cancel mutation,
  // and no un-cancel mutation exists at all. Both queue actions route to
  // opening the sheet rather than inventing backend behavior that doesn't
  // exist — see the task-8 report for the full reasoning.
  const cancelDate = (dateId: string) => openShowDate(dateId);
  const undoCancel = (dateId: string) => openShowDate(dateId);

  // "Preview" (ready-to-issue secondary). The `generate-hire-orders` `preview`
  // action only supports `order_id` (or none, for a generic sample) — a
  // ready-to-issue date has no order yet, so there is no per-date preview to
  // call. Routes to the sheet instead of firing a mutation that would silently
  // render the org's generic sample document under a date-specific label.
  const previewHireOrder = (dateId: string) => openShowDate(dateId);

  /** Offer the queue's shortlisted artist for the top at-risk date. Note:
   *  `openOfferTier` offers the WHOLE eligible set for the tier — there is no
   *  single-artist offer endpoint, so `artistId` can't target just the clicked
   *  row (see the task-8 report's "Open risk"). */
  const offerArtist = (dateId: string, _artistId: string) => {
    if (!canRunOfferEngine) return;
    void openOfferTier(supabase, { showDateId: dateId, tier: 1 })
      .then(({ offersCreated }) => {
        const label = t('needsYou.toast.offered', { count: offersCreated });
        toast.success(label);
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
        if (offersCreated) addReceipt(dateId, label);
      })
      .catch((e) => toast.error((e as Error).message));
  };

  // Both bulk wrappers push a receipt per date once dispatched — `confirmAll`
  // after the shared `confirmHoldsForDate` calls settle (it swallows its own
  // errors internally rather than rejecting, so `.then()` always fires once
  // every date has been attempted); `generateAll` right after firing, since
  // `draftHireOrderForDate` is a fire-and-forget `.mutate()` with no promise
  // to await. Deliberately NOT added inside `confirmHoldsForDate`/
  // `draftHireOrderForDate` themselves — those are shared with Month/Agenda/
  // DayRail, which have no "Cleared today" concept.
  const confirmAll = (ids: string[]) => {
    if (!(canConfirmBookings && bookingOn)) return;
    void Promise.all(ids.map((id) => confirmHoldsForDate(id))).then(() => {
      ids.forEach((id) => addReceipt(id, t('needsYou.toast.confirmedAll')));
    });
  };
  const generateAll = (ids: string[]) => {
    if (!canGenerateHireOrders) return;
    ids.forEach((id) => {
      draftHireOrderForDate(id);
      addReceipt(id, t('needsYou.toast.generatedAll'));
    });
  };

  // Cockpit pager: walk the current filtered/sorted list from the open sheet.
  const sheetPager = useMemo(() => {
    const pos = pagerPosition(filtered.map(sd => sd.id), activeShowDateId);
    if (!pos) return undefined;
    return {
      index: pos.index,
      total: pos.total,
      onPrev: () => { if (pos.prevId) openShowDate(pos.prevId); },
      onNext: () => { if (pos.nextId) openShowDate(pos.nextId); },
    };
  }, [activeShowDateId, filtered]);

  const updateStatusFilter = (v: 'all' | DisplayStatus) => {
    setStatusFilter(v);
    const next = new URLSearchParams(searchParams);
    if (v === 'all') next.delete('status'); else next.set('status', v);
    setSearchParams(next, { replace: true });
  };

  const updateLens = (key: string) => {
    setLens(key as 'needs-you' | 'month' | 'agenda');
    const next = new URLSearchParams(searchParams);
    next.set('lens', key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">{t('producer.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('producer.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {setupMode === "button" && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setSetupStep(undefined); setSetupSheetOpen(true); }}
            >
              <ListChecks className="h-4 w-4" />
              {t('producer.setupChecklist')}
            </Button>
          )}
          {canManage && <Button onClick={() => setNewDateOpen(true)}>{t('producer.newDate')}</Button>}
        </div>
      </div>

      {canManage && hireOrdersOn && readyCount > 0 && (
        <HireOrderReadyBanner
          title={t('producer.hireOrderReady.title', { count: readyCount })}
          description={t('producer.hireOrderReady.description')}
          ctaLabel={t('producer.hireOrderReady.cta')}
          onCta={() => setWizardOpen(true)}
          disabled={!canGenerateHireOrders}
          ctaTitle={canGenerateHireOrders ? undefined : t('producer.noHireOrderPermission')}
        />
      )}

      <PageMini page="bookings" />

      {/* The dashboard-style setup rail, module-scoped, near the top of the page. Its step
          buttons open the inline checklist Sheet at that step (the "do it here" surface);
          Hide dismisses it on this surface only. */}
      {setupMode === "banner" && (
        <DashboardSetupRail
          layout="banner"
          eyebrow={rail.eyebrow}
          title={rail.title}
          body={rail.body}
          complete={false}
          steps={rail.steps}
          rules={rail.rules}
          offFooters={rail.offFooters}
          progressLabel={rail.progressLabel}
          progressFilled={rail.progressFilled}
          progressTotal={rail.progressTotal}
          onStepAction={openSetupAt}
          onClose={rail.dismiss}
          onDismiss={rail.dismiss}
        />
      )}
      {setupMode === "collapsed" && (
        <DashboardWelcomeCollapsed
          label={rail.collapsedLabel}
          hint={rail.collapsedHint}
          ctaLabel={rail.collapsedCta}
          onOpen={rail.expand}
        />
      )}

      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('producer.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {canSee('status') && (
          <Select value={statusFilter} onValueChange={v => updateStatusFilter(v as 'all' | DisplayStatus)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder={t('producer.statusPlaceholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('producer.allStatuses')}</SelectItem>
              <SelectItem value="open">{STATUS_LABEL.open}</SelectItem>
              <SelectItem value="partially_filled">{STATUS_LABEL.partially_filled}</SelectItem>
              <SelectItem value="fully_filled">{STATUS_LABEL.fully_filled}</SelectItem>
              <SelectItem value="cancelled">{STATUS_LABEL.cancelled}</SelectItem>
              <SelectItem value="unconfigured">{STATUS_LABEL.unconfigured}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel={t('producer.sortChronoLabel')} extraOptions={sortExtraOptions} />}
        {filterableDefs.map(def => (
          <CustomFieldFilter
            key={def.id}
            def={def}
            value={customFilters[`custom.${def.key}`] ?? emptyCustomFilter(def.type)}
            onChange={(v) => setCustomFilters(prev => ({ ...prev, [`custom.${def.key}`]: v }))}
          />
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">{t('producer.emptyState')}</div>
      ) : (
        <CalendarSurface
          role="producer"
          producerEntries={producerEntries}
          lens={lens}
          onLensChange={updateLens}
          needsYouQueue={needsYouQueue}
          queueShortlist={queueShortlist}
          clearedToday={clearedToday}
          onUndoLastReceipt={onUndoLastReceipt}
          actions={{
            confirmHolds,
            generateHireOrder,
            openDate: openShowDate,
            openCasting: openCastingDate,
            extendHold,
            releaseHold,
            notifyCast: notifyCastAction,
            cancelDate,
            undoCancel,
            previewHireOrder,
            offerArtist,
            confirmAll,
            generateAll,
          }}
          actionGates={{
            confirmHolds: {
              disabled: !(canConfirmBookings && bookingOn),
              title: t('producer.noConfirmPermission'),
            },
            generateHireOrder: {
              disabled: !canGenerateHireOrders,
              title: t('producer.noHireOrderPermission'),
            },
          }}
        />
      )}
      </div>

      <SetupChecklistSheet
        feature="booking_flow"
        orgId={bookingEntitledForWrites ? orgId : null}
        open={setupSheetOpen}
        onOpenChange={setSetupSheetOpen}
        initialStep={setupStep}
      />

      <ShowDateDetailSheet
        showDateId={activeShowDateId}
        open={!!activeShowDateId}
        onOpenChange={o => { if (!o) setActiveShowDateId(null); }}
        pager={sheetPager}
        initialTab={sheetInitialTab}
      />
      <ShowDateFormDialog open={newDateOpen} onOpenChange={setNewDateOpen} mode="create" />
      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} orgId={orgId} />
    </div>
  );
}
