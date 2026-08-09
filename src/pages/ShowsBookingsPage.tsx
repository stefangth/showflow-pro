import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { bulkConfirmSoftBooked, fetchBookingCountsByDate, fetchSoftBookedIdsForDate } from '@/data/bookings';
import { fetchShowDatesList } from '@/data/showDates';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { PopoverAnchor } from '@radix-ui/react-popover';
import { RowPeek } from '@/components/bookings/RowPeek';
import { computeDatePeek, pagerPosition } from '@/lib/bookingCockpit';
import { Search, Plus, ListChecks } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, upcomingTimeframe, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ArtistBookingsView } from '@/components/bookings/ArtistBookingsView';
import { FirstOfferCard } from '@/components/bookings/setup/FirstOfferCard';
import { DashboardSetupRail } from '@/components/dashboard/firstRun/DashboardSetupRail';
import { DashboardWelcomeCollapsed } from '@/components/dashboard/firstRun/DashboardWelcomeCollapsed';
import { useModuleOnboardingRail } from '@/components/setup/useModuleOnboardingRail';
import { SetupChecklistSheet } from '@/components/setup/SetupChecklistSheet';
import type { ComposedStep } from '@/lib/dashboard/types';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { NewOrderWizard } from '@/components/hireOrders/NewOrderWizard';
import { HireOrderReadyBanner } from '@/components/hireOrders/HireOrderReadyBanner';
import { useDatesReadyForHireOrder, useHireOrderAction } from '@/hooks/useHireOrders';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { useFeature, useEntitlements } from '@/hooks/useEntitlements';
import { useCan } from '@/hooks/useCapabilities';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSlots } from '@/lib/settings';
import { formatDateWithWeekday, parseDateOnly, pastRowClassName } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useReferenceField } from '@/hooks/useBookingFlow';
import { referenceLabel } from '@/lib/bookingFlow';
import { useColumnTemplate, useEditorConfig } from '@/features/editor/EditorContext';
import { useColumnHeaders } from '@/features/editor/useColumnHeaders';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';
import { formatCustomValue, compareCustomValues, customFilterMatches, type CustomFilterState } from '@/lib/customFields';
import { CustomFieldFilter } from '@/components/filters/CustomFieldFilter';
import { emptyCustomFilter } from '@/components/filters/customFilterState';

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

const STATUS_LABEL: Record<DisplayStatus, string> = {
  open: 'Open',
  partially_filled: 'Partially Filled',
  fully_filled: 'Fully Filled',
  cancelled: 'Cancelled',
  unconfigured: 'Unconfigured',
};

const STATUS_STYLE: Record<DisplayStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  partially_filled: 'bg-warning/10 text-warning',
  fully_filled: 'bg-success/10 text-success',
  cancelled: 'bg-destructive/10 text-destructive',
  unconfigured: 'bg-destructive/10 text-destructive',
};

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
  const { canSee } = useFilterVisibility('bookings');
  const { reference, customFieldKey } = useReferenceField();
  const { orderedColumns, visibleCount } = useColumnTemplate('bookings-producer');
  const { isEditorMode, getCustomFieldDefs } = useEditorConfig();
  const columnHeaders = useColumnHeaders(orderedColumns);
  const customDefs = useMemo(() => getCustomFieldDefs('show_dates'), [getCustomFieldDefs]);
  const customByColId = useMemo(
    () => new Map(customDefs.map(d => [`custom.${d.key}`, d])),
    [customDefs]
  );
  const filterableDefs = useMemo(() => customDefs.filter(d => d.filterable), [customDefs]);
  const sortableDefs = useMemo(() => customDefs.filter(d => d.sortable), [customDefs]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => upcomingTimeframe());
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
  type ProducerSort = SortValue | `custom:${string}`;
  const [sort, setSort] = useState<ProducerSort>('chrono_asc');
  const isCustomSort = (s: ProducerSort): s is `custom:${string}` => s.startsWith('custom:');
  const sortExtraOptions = sortableDefs.flatMap(d => ([
    { value: `custom:${d.key}:asc` as ProducerSort, label: `${d.label} ↑` },
    { value: `custom:${d.key}:desc` as ProducerSort, label: `${d.label} ↓` },
  ]));
  const [customFilters, setCustomFilters] = useState<Record<string, CustomFilterState>>({});
  const [view, setView] = useState<ViewMode>('list');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);
  const openShowDate = (id: string) => setActiveShowDateId(id);

  // Row peek: Space opens a compact popover summarizing the date's fill (via
  // computeDatePeek), Enter still opens the full ShowDateDetailSheet (unchanged
  // click behavior), Escape closes an open peek. Anchored to whichever row/card
  // is active via a ref rather than one Popover per row, since columns are
  // admin-configurable (no fixed cell to anchor to).
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekAnchorRef = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmingPeek, setConfirmingPeek] = useState(false);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  };
  const clearCloseTimer = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };
  useEffect(() => () => { clearHoverTimer(); clearCloseTimer(); }, []);

  const openShowDateOnKey = (id: string) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearHoverTimer();
      clearCloseTimer();
      setPeekId(null);
      openShowDate(id);
    } else if (e.key === ' ') {
      e.preventDefault();
      clearHoverTimer();
      clearCloseTimer();
      peekAnchorRef.current = e.currentTarget;
      setPeekId(id);
    } else if (e.key === 'Escape') {
      clearHoverTimer();
      clearCloseTimer();
      setPeekId(null);
    }
  };
  // Calendar-view cards are role="button"; the ARIA button pattern requires
  // Space and Enter to both activate. They carry no peek affordance, so keep
  // the original open-on-either behaviour rather than the list row's Space=peek.
  const openShowDateOnCardKey = (id: string) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openShowDate(id);
    }
  };
  // Hover intent: a short delay before opening (avoids flashing the peek on a
  // pointer just passing through) and a short delay before closing (gives the
  // pointer time to travel from the row onto the popover itself).
  const handleRowMouseEnter = (id: string) => (e: React.MouseEvent<HTMLTableRowElement>) => {
    clearCloseTimer();
    const row = e.currentTarget;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      peekAnchorRef.current = row;
      setPeekId(id);
    }, 250);
  };
  const handleRowMouseLeave = () => {
    clearHoverTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setPeekId(null), 150);
  };
  const handlePopoverMouseEnter = () => clearCloseTimer();
  const handlePopoverMouseLeave = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setPeekId(null), 150);
  };
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
  // `visible` drives the inline callout, `reinvocable` drives the header button
  // (Plan B Task 3's re-invoke) -- both read off the SAME hook and the same inputs, so
  // the header button can never offer to reopen a rail that would render nothing
  // actionable (the divergence a separately-computed `dismissed && !complete` used to
  // allow, e.g. for a non-editor once offers are already possible).
  const rail = useModuleOnboardingRail('booking_flow', bookingEntitledForWrites ? orgId : null);
  const setupMode = bookingEntitledForWrites ? rail.mode : 'hidden';
  const [setupSheetOpen, setSetupSheetOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<string | undefined>(undefined);
  const openSetupAt = (step: ComposedStep) => { setSetupStep(step.key); setSetupSheetOpen(true); };
  // Hire-order CTA: module gate + generate capability + which dates are ready.
  const hireOrdersOn = useFeature('hire_orders');
  const canGenerateHireOrders = useCan('generate_hire_orders');
  // Row peek's Confirm action, gated the same as the sheet's own confirm control.
  const canConfirmBookings = useCan('confirm_bookings');
  const { data: hireOrderReady } = useDatesReadyForHireOrder(hireOrdersOn ? orgId : null);
  const readyCount = hireOrderReady?.readyIds.length ?? 0;
  const readySet = useMemo(() => new Set(hireOrderReady?.readyIds ?? []), [hireOrderReady]);
  const hireOrderAction = useHireOrderAction();
  const draftHireOrderForDate = (dateId: string) => {
    if (!orgId) return;
    hireOrderAction.mutate({ action: 'draft', org_id: orgId, show_date_id: dateId, notify: false });
  };
  // Only the row whose draft is in flight shows pending. The mutation instance is
  // shared across every row's button, so gating on `isPending` alone would disable
  // all ready rows on any single click.
  const pendingHireOrderDateId = hireOrderAction.isPending
    ? (hireOrderAction.variables as { show_date_id?: string } | undefined)?.show_date_id
    : undefined;

  /** The peek's Confirm action: lazily fetch the date's soft_booked ids, bulk-confirm
   *  them, then invalidate the whole bookings domain (never just the counts sub-key).
   *  Always gives feedback and refreshes, even when the cached count was stale and no
   *  rows remain to confirm. */
  async function confirmPeek(showDateId: string) {
    setConfirmingPeek(true);
    try {
      const ids = await fetchSoftBookedIdsForDate(supabase, showDateId);
      const { affected } = ids.length
        ? await bulkConfirmSoftBooked(supabase, { ids, now: new Date() })
        : { affected: 0 };
      toast.success(affected ? `Confirmed ${affected}` : 'Nothing to confirm, it moved on');
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmingPeek(false);
      setPeekId(null);
    }
  }

  useEffect(() => {
    const status = searchParams.get('status');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (status && ['open', 'partially_filled', 'fully_filled', 'cancelled', 'unconfigured'].includes(status)) {
      setStatusFilter(status as DisplayStatus);
    }
    if (from || to) {
      setTimeframe({ from: from ? parseISO(from) : null, to: to ? parseISO(to) : null });
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

  const calendarItems = useMemo(() =>
    filtered.map(sd => ({ showDate: sd, date: parseDateOnly(sd.date) })),
    [filtered]
  );

  const peekedShowDate = useMemo(
    () => (peekId ? filtered.find(sd => sd.id === peekId) ?? null : null),
    [filtered, peekId]
  );

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

  const dayAbbr = (dateStr: string) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[parseDateOnly(dateStr).getDay()];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Shows &amp; Bookings</h1>
          <p className="text-muted-foreground mt-1">All scheduled dates and cast status in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          {setupMode === "button" && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setSetupStep(undefined); setSetupSheetOpen(true); }}
            >
              <ListChecks className="h-4 w-4" />
              Setup checklist
            </Button>
          )}
          {canManage && <Button onClick={() => setNewDateOpen(true)}>New date</Button>}
        </div>
      </div>

      {canManage && hireOrdersOn && readyCount > 0 && (
        <HireOrderReadyBanner
          title={`${readyCount} ${readyCount === 1 ? 'date is' : 'dates are'} fully filled. Ready for hire order${readyCount === 1 ? '' : 's'}.`}
          description="Create the orders to confirm the engagements and send them for countersignature."
          ctaLabel="Generate hire orders"
          onCta={() => setWizardOpen(true)}
          disabled={!canGenerateHireOrders}
          ctaTitle={canGenerateHireOrders ? undefined : "You don't have permission to generate hire orders"}
        />
      )}

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
            placeholder="Search program, venue, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {canSee('status') && (
          <Select value={statusFilter} onValueChange={v => updateStatusFilter(v as 'all' | DisplayStatus)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="partially_filled">Partially Filled</SelectItem>
              <SelectItem value="fully_filled">Fully Filled</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="unconfigured">Unconfigured</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Date" extraOptions={sortExtraOptions} />}
        {filterableDefs.map(def => (
          <CustomFieldFilter
            key={def.id}
            def={def}
            value={customFilters[`custom.${def.key}`] ?? emptyCustomFilter(def.type)}
            onChange={(v) => setCustomFilters(prev => ({ ...prev, [`custom.${def.key}`]: v }))}
          />
        ))}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      <ColumnLayoutEditor pageKey="bookings-producer" />

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : view === 'list' ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columnHeaders.map(({ columnId, headerLabel }) => (
                    <TableHead key={columnId} className={isEditorMode ? 'font-mono text-xs' : 'text-xs'}>
                      {headerLabel}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(sd => {
                  const slotConfig = showSlots(sd.show);
                  const status = displayStatus(sd);
                  const counts = bookingCounts?.get(sd.id);
                  const cellFor = (colId: string) => {
                    switch (colId) {
                      case 'show_dates.date': return (
                        <TableCell key={colId} className="font-medium whitespace-nowrap">
                          {format(parseDateOnly(sd.date), 'dd MMM yyyy')}
                        </TableCell>
                      );
                      case '_computed.day': return (
                        <TableCell key={colId} className="text-muted-foreground">{dayAbbr(sd.date)}</TableCell>
                      );
                      case 'show_dates.session_1': return (
                        <TableCell key={colId} className="whitespace-nowrap">{sd.session_1 ? sd.session_1.slice(0, 5) : '—'}</TableCell>
                      );
                      case 'show_dates.session_2': return (
                        <TableCell key={colId} className="whitespace-nowrap">
                          {sd.session_2 ? sd.session_2.slice(0, 5) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                      case 'show_dates.session_3': return (
                        <TableCell key={colId} className="whitespace-nowrap">
                          {sd.session_3 ? sd.session_3.slice(0, 5) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                      case 'shows.program': return (
                        <TableCell key={colId}>{sd.show?.program || <span className="text-muted-foreground">—</span>}</TableCell>
                      );
                      case 'shows.sub_program': return (
                        <TableCell key={colId}>{sd.show?.sub_program || <span className="text-muted-foreground">—</span>}</TableCell>
                      );
                      case 'show_dates.venue': return (
                        <TableCell key={colId}>{sd.venue || <span className="text-muted-foreground">—</span>}</TableCell>
                      );
                      case 'cities.name': return (
                        <TableCell key={colId}>{sd.city?.name || <span className="text-muted-foreground">—</span>}</TableCell>
                      );
                      case 'show_dates.status': {
                        // Inline hire-order affordance: a fully-filled, unordered date
                        // flips to a per-row Generate CTA; once ordered it shows the
                        // order's status chip. Gated by the module + generate capability.
                        const activeOrder = hireOrderReady?.orderByDate[sd.id];
                        const readyForOrder = readySet.has(sd.id);
                        return (
                          <TableCell key={colId}>
                            <Badge variant="secondary" className={STATUS_STYLE[status] ?? STATUS_STYLE.open}>
                              {STATUS_LABEL[status] ?? status}
                            </Badge>
                            {sd.status === 'cancelled' && sd.cancellation_reason && (
                              <div className="mt-1 text-xs text-destructive">{sd.cancellation_reason}</div>
                            )}
                            {hireOrdersOn && canManage && activeOrder && (
                              <div className="mt-1.5"><HireOrderStatusBadge status={activeOrder.status} /></div>
                            )}
                            {hireOrdersOn && canManage && !activeOrder && readyForOrder && (
                              <div className="mt-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  disabled={!canGenerateHireOrders || pendingHireOrderDateId === sd.id}
                                  title={canGenerateHireOrders ? undefined : "You don't have permission to generate hire orders"}
                                  onClick={(e) => { e.stopPropagation(); draftHireOrderForDate(sd.id); }}
                                >
                                  <Plus className="mr-1 h-3 w-3" /> Generate hire order
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        );
                      }
                      case 'show_dates.notes': return (
                        <TableCell key={colId} className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {sd.notes || '—'}
                        </TableCell>
                      );
                      case 'shows.id':
                      case 'show_dates.id':
                      case 'show_dates.show_id': return (
                        <TableCell key={colId} className="font-mono text-xs text-muted-foreground">
                          {colId === 'shows.id' ? sd.show?.id : colId === 'show_dates.id' ? sd.id : sd.show_id}
                        </TableCell>
                      );
                      case '_computed.slots': return (
                        <TableCell key={colId} className="whitespace-nowrap text-sm">
                          {slotConfig !== null ? (
                            <span className="text-muted-foreground tabular-nums">
                              {counts?.confirmedMain ?? 0}/{slotConfig.main_cast}
                              {' + '}
                              {counts?.confirmedUs ?? 0}/{slotConfig.understudies}
                            </span>
                          ) : (
                            <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>
                          )}
                        </TableCell>
                      );
                      default: {
                        // Custom (Airtable-synced) columns — display/filter/sort ONLY, never booking logic.
                        if (colId.startsWith('custom.')) {
                          const def = customByColId.get(colId);
                          const val = sd.custom?.[colId.slice('custom.'.length)];
                          return (
                            <TableCell key={colId} className="text-sm whitespace-nowrap">
                              {def ? formatCustomValue(val, def.type) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={colId} className="text-xs text-muted-foreground">—</TableCell>
                        );
                      }
                    }
                  };
                  return (
                    <TableRow
                      key={sd.id}
                      className={cn('cursor-pointer', pastRowClassName(parseDateOnly(sd.date)))}
                      tabIndex={0}
                      onClick={() => openShowDate(sd.id)}
                      onKeyDown={openShowDateOnKey(sd.id)}
                      onMouseEnter={handleRowMouseEnter(sd.id)}
                      onMouseLeave={handleRowMouseLeave}
                    >
                      {orderedColumns.filter(c => c.visible).map(c => cellFor(c.columnId))}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleCount || 9} className="text-center text-muted-foreground py-12">
                      No show dates match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EntityCalendar
          items={calendarItems}
          getDate={it => it.date}
          emptyMessage="No show dates scheduled"
          renderItem={it => (
            <Card
              className={cn(
                'hover:shadow-elev2 transition-shadow cursor-pointer',
                pastRowClassName(it.date),
              )}
              role="button"
              tabIndex={0}
              onClick={() => openShowDate(it.showDate.id)}
              onKeyDown={openShowDateOnCardKey(it.showDate.id)}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {referenceLabel({ reference, show: it.showDate.show, custom: it.showDate.custom, customFieldKey })}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[it.showDate.venue, it.showDate.city?.name]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={STATUS_STYLE[displayStatus(it.showDate)] ?? STATUS_STYLE.open}
                >
                  {STATUS_LABEL[displayStatus(it.showDate)] ?? it.showDate.status}
                </Badge>
              </CardContent>
            </Card>
          )}
        />
      )}
      </div>

      {peekedShowDate && (
        // key=peekId remounts the popover when the active row changes, forcing
        // Radix to re-measure against the new anchor instead of keeping the prior
        // row's position when the pointer moves between rows without closing.
        <Popover key={peekId} open onOpenChange={o => { if (!o) setPeekId(null); }}>
          <PopoverAnchor virtualRef={peekAnchorRef} />
          <PopoverContent
            // Anchor is the full-width row, so `side="right"` shoved the 320px
            // peek off the right edge of the viewport. Drop it below the row,
            // left-aligned, and let Radix flip/shift to stay fully on-screen.
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="w-auto p-0"
            // The peek is a passive hover/Space affordance. Prevent Radix's
            // default mount auto-focus so opening the peek never steals focus
            // onto the (destructive) Confirm button — otherwise the hint's own
            // "Enter to open" keystroke would land on Confirm and bulk-confirm.
            onOpenAutoFocus={e => e.preventDefault()}
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handlePopoverMouseLeave}
            onClick={e => e.stopPropagation()}
          >
            <RowPeek
              dateLabel={formatDateWithWeekday(peekedShowDate.date)}
              peek={computeDatePeek({
                counts: bookingCounts?.get(peekedShowDate.id) ?? null,
                slots: showSlots(peekedShowDate.show),
              })}
              canConfirm={canConfirmBookings && bookingOn}
              confirming={confirmingPeek}
              onConfirm={() => confirmPeek(peekedShowDate.id)}
              onOpen={() => { setPeekId(null); openShowDate(peekedShowDate.id); }}
            />
          </PopoverContent>
        </Popover>
      )}

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
      />
      <ShowDateFormDialog open={newDateOpen} onOpenChange={setNewDateOpen} mode="create" />
      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} orgId={orgId} />
    </div>
  );
}
