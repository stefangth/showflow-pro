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
import { Search } from 'lucide-react';
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
import { useSubProgramSlots, effectiveSlots } from '@/hooks/useSubProgramSlots';
import { showLabel } from '@/types';
import { useColumnTemplate, useEditorConfig } from '@/features/editor/EditorContext';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';

type ShowRef = {
  id: string;
  program: string | null;
  sub_program: string | null;
  required_skills: string[] | null;
  status: 'active' | 'archived' | 'draft';
};

type CityRef = { id: string; name: string } | null;

type ShowDateRow = {
  id: string;
  date: string;
  session_1: string;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  status: 'open' | 'partially_filled' | 'fully_filled' | 'cancelled';
  notes: string | null;
  city_id: string | null;
  show_id: string;
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
  const { orderedColumns, visibleCount } = useColumnTemplate('bookings-producer');
  const { isEditorMode, getColumnLabel } = useEditorConfig();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
  const slotDefaults = useSubProgramSlots();
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);

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
      const map = new Map<string, { confirmedMain: number; confirmedUs: number; total: number }>();
      (data ?? []).forEach((b: any) => {
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
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id,
          show:shows(id, program, sub_program, required_skills, status),
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
    if (sd.status === 'open' && !effectiveSlots(slotDefaults, sd.show?.program, sd.show?.sub_program)) {
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
      list = list.filter(sd => inTimeframe(new Date(sd.date + 'T00:00:00'), timeframe));
    }
    if (statusFilter !== 'all') {
      list = list.filter(sd => displayStatus(sd) === statusFilter);
    }
    return applySort(list, sort,
      sd => sd.show?.program ?? '',
      sd => new Date(sd.date + 'T00:00:00')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDates, search, programs, timeframe, statusFilter, sort, slotDefaults]);

  const calendarItems = useMemo(() =>
    filtered.map(sd => ({ showDate: sd, date: new Date(sd.date + 'T00:00:00') })),
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
    return days[new Date(dateStr + 'T00:00:00').getDay()];
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Shows &amp; Bookings</h1>
        <p className="text-muted-foreground mt-1">All scheduled dates and cast status in one place.</p>
      </div>

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
          <Select value={statusFilter} onValueChange={v => updateStatusFilter(v as any)}>
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
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Date" />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      <ColumnLayoutEditor pageKey="bookings-producer" />

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
      ) : view === 'list' ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {(() => {
                    const visible = orderedColumns.filter(c => c.visible);
                    const labelCounts = new Map<string, number>();
                    visible.forEach(c => {
                      const lbl = getColumnLabel(c.columnId);
                      labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
                    });
                    return visible.map(c => {
                      const lbl = getColumnLabel(c.columnId);
                      const headerLbl = (labelCounts.get(lbl) ?? 1) > 1 ? c.columnId : lbl;
                      return (
                        <TableHead key={c.columnId} className={isEditorMode ? 'font-mono text-xs' : 'text-xs'}>
                          {isEditorMode ? c.columnId : headerLbl}
                        </TableHead>
                      );
                    });
                  })()}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(sd => {
                  const slotConfig = effectiveSlots(slotDefaults, sd.show?.program, sd.show?.sub_program);
                  const status = displayStatus(sd);
                  const counts = bookingCounts?.get(sd.id);
                  const cellFor = (colId: string) => {
                    switch (colId) {
                      case 'show_dates.date': return (
                        <TableCell key={colId} className="font-medium whitespace-nowrap">
                          {format(new Date(sd.date + 'T00:00:00'), 'dd MMM yyyy')}
                        </TableCell>
                      );
                      case '_computed.day': return (
                        <TableCell key={colId} className="text-muted-foreground">{dayAbbr(sd.date)}</TableCell>
                      );
                      case 'show_dates.session_1': return (
                        <TableCell key={colId} className="whitespace-nowrap">{sd.session_1.slice(0, 5)}</TableCell>
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
                      case 'show_dates.status': return (
                        <TableCell key={colId}>
                          <Badge variant="secondary" className={STATUS_STYLE[status] ?? STATUS_STYLE.open}>
                            {STATUS_LABEL[status] ?? status}
                          </Badge>
                        </TableCell>
                      );
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
                      default: return (
                        <TableCell key={colId} className="text-xs text-muted-foreground">—</TableCell>
                      );
                    }
                  };
                  return (
                    <TableRow
                      key={sd.id}
                      className="cursor-pointer"
                      onClick={() => setActiveShowDateId(sd.id)}
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
              onClick={() => setActiveShowDateId(it.showDate.id)}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{showLabel(it.showDate.show)}</p>
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
    </div>
  );
}
