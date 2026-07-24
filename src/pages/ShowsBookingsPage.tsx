import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ArtistBookingsView } from '@/components/bookings/ArtistBookingsView';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { NewOrderWizard } from '@/components/hireOrders/NewOrderWizard';
import { HireOrderReadyBanner } from '@/components/hireOrders/HireOrderReadyBanner';
import { useDatesReadyForHireOrder, useHireOrderAction } from '@/hooks/useHireOrders';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { useFeature } from '@/hooks/useEntitlements';
import { useCan } from '@/hooks/useCapabilities';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSlots } from '@/lib/settings';
import { parseDateOnly } from '@/lib/dates';
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
  // hasRole respects viewAsRole simulation, so an admin viewing-as-artist gets ArtistBookingsView
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistBookingsView />;
  }
  return <ProducerShowsBookings />;
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
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
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
  const openShowDateOnKey = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openShowDate(id);
    }
  };
  const [newDateOpen, setNewDateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { hasRole, currentOrg } = useAuth();
  const canManage = hasRole('admin') || hasRole('producer');
  const orgId = currentOrg?.id ?? null;
  // Hire-order CTA: module gate + generate capability + which dates are ready.
  const hireOrdersOn = useFeature('hire_orders');
  const canGenerateHireOrders = useCan('generate_hire_orders');
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
    queryKey: ['bookings', 'counts-by-date'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('show_date_id, status, is_understudy')
        .neq('status', 'cancelled');
      if (error) throw error;
      interface CountRow { show_date_id: string; status: string; is_understudy: boolean }
      const rows = (data ?? []) as unknown as CountRow[];
      const map = new Map<string, { confirmedMain: number; confirmedUs: number; total: number }>();
      rows.forEach((b) => {
        const cur = map.get(b.show_date_id) ?? { confirmedMain: 0, confirmedUs: 0, total: 0 };
        cur.total += 1;
        if (b.status === 'confirmed') {
          if (b.is_understudy) cur.confirmedUs += 1;
          else cur.confirmedMain += 1;
        }
        map.set(b.show_date_id, cur);
      });
      return map;
    },
  });

  const { data: showDates, isLoading } = useQuery({
    queryKey: ['show-dates', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select(`
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, custom, cancellation_reason,
          show:shows(id, program, sub_program, status, main_cast_slots, understudy_slots),
          city:cities(id, name)
        `)
        .order('date', { ascending: true });
      if (error) throw error;
      return data as unknown as ShowDateRow[];
    },
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
        {canManage && <Button onClick={() => setNewDateOpen(true)}>New date</Button>}
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
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => openShowDate(sd.id)}
                      onKeyDown={openShowDateOnKey(sd.id)}
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
              className="hover:shadow-elev2 transition-shadow cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => openShowDate(it.showDate.id)}
              onKeyDown={openShowDateOnKey(it.showDate.id)}
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

      <ShowDateDetailSheet
        showDateId={activeShowDateId}
        open={!!activeShowDateId}
        onOpenChange={o => { if (!o) setActiveShowDateId(null); }}
      />
      <ShowDateFormDialog open={newDateOpen} onOpenChange={setNewDateOpen} mode="create" />
      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} orgId={orgId} />
    </div>
  );
}
