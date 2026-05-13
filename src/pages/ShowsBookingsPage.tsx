import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { showLabel } from '@/types';
import { useSubProgramSlots, effectiveSlots } from '@/hooks/useSubProgramSlots';

type ShowRef = {
  id: string;
  program: string | null;
  sub_program: string | null;
  venue: string | null;
  required_skills: string[] | null;
  status: 'active' | 'archived' | 'draft';
};

type CityRef = { id: string; name: string } | null;

type ShowDateRow = {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_override: string | null;
  status: 'open' | 'partially_filled' | 'fully_filled' | 'cancelled';
  notes: string | null;
  city_id: string | null;
  show_id: string;
  show: ShowRef;
  city: CityRef;
};

type BookingLite = { show_date_id: string; status: string; is_understudy: boolean };

type DerivedStatus = 'cast_confirmed' | 'cast_pending' | 'open' | 'cancelled' | 'unconfigured';

const STATUS_LABEL: Record<DerivedStatus, string> = {
  cast_confirmed: 'Cast Confirmed',
  cast_pending: 'Cast Pending',
  open: 'Open',
  cancelled: 'Cancelled',
  unconfigured: 'Unconfigured',
};

const STATUS_STYLE: Record<DerivedStatus, string> = {
  cast_confirmed: 'bg-success/10 text-success',
  cast_pending: 'bg-warning/10 text-warning',
  open: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  unconfigured: 'bg-destructive/10 text-destructive',
};

export default function ShowsBookingsPage() {
  const { hasRole } = useAuth();
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistBookingsView />;
  }
  return <ProducerShowsBookings />;
}

function ProducerShowsBookings() {
  const { canSee } = useFilterVisibility('bookings');
  const [searchParams, setSearchParams] = useSearchParams();
  const slotDefaults = useSubProgramSlots();

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [statusFilter, setStatusFilter] = useState<'all' | DerivedStatus>('all');
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);

  useEffect(() => {
    const status = searchParams.get('status');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (status && ['cast_confirmed', 'cast_pending', 'open', 'cancelled', 'unconfigured'].includes(status)) {
      setStatusFilter(status as DerivedStatus);
    }
    if (from || to) {
      setTimeframe({ from: from ? parseISO(from) : null, to: to ? parseISO(to) : null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: showDates, isLoading } = useQuery({
    queryKey: ['bookings', 'show-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select(`
          id, date, start_time, end_time, venue_override, status, notes, city_id, show_id,
          show:shows(id, program, sub_program, venue, required_skills, status),
          city:cities(id, name)
        `)
        .order('date', { ascending: true });
      if (error) throw error;
      return data as unknown as ShowDateRow[];
    },
  });

  const { data: bookings } = useQuery({
    queryKey: ['bookings', 'status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('show_date_id, status, is_understudy')
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  const confirmedMainByDate = useMemo(() => {
    const map = new Map<string, number>();
    (bookings ?? []).forEach(b => {
      if (b.status === 'confirmed' && !b.is_understudy) {
        map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
      }
    });
    return map;
  }, [bookings]);

  const anyBookingByDate = useMemo(() => {
    const set = new Set<string>();
    (bookings ?? []).forEach(b => set.add(b.show_date_id));
    return set;
  }, [bookings]);

  const derivedStatus = (sd: ShowDateRow): DerivedStatus => {
    if (sd.status === 'cancelled') return 'cancelled';
    const config = effectiveSlots(slotDefaults, sd.show?.sub_program ?? null);
    if (!config) return 'unconfigured';
    const confirmedMain = confirmedMainByDate.get(sd.id) ?? 0;
    if (confirmedMain >= config.main_cast) return 'cast_confirmed';
    if (anyBookingByDate.has(sd.id)) return 'cast_pending';
    return 'open';
  };

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    showDates?.forEach(sd => sd.show?.program && set.add(sd.show.program));
    return Array.from(set).sort();
  }, [showDates]);

  const filtered = useMemo(() => {
    if (!showDates) return [];
    let list = showDates.filter(sd => {
      const venue = sd.venue_override ?? sd.show?.venue ?? '';
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
      list = list.filter(sd => derivedStatus(sd) === statusFilter);
    }
    return applySort(list, sort,
      sd => sd.show?.program ?? '',
      sd => new Date(sd.date + 'T00:00:00')
    );
  }, [showDates, search, programs, timeframe, statusFilter, sort, slotDefaults, confirmedMainByDate, anyBookingByDate]);

  const calendarItems = useMemo(() =>
    filtered.map(sd => ({ showDate: sd, date: new Date(sd.date + 'T00:00:00') })),
    [filtered]
  );

  const updateStatusFilter = (v: 'all' | DerivedStatus) => {
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
        <h1 className="font-display text-3xl font-bold">Shows &amp; Bookings</h1>
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
              <SelectItem value="cast_confirmed">Cast Confirmed</SelectItem>
              <SelectItem value="cast_pending">Cast Pending</SelectItem>
              <SelectItem value="open">Open</SelectItem>
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

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
      ) : view === 'list' ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Sub Program</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Slots</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(sd => {
                  const status = derivedStatus(sd);
                  const config = effectiveSlots(slotDefaults, sd.show?.sub_program ?? null);
                  const venue = sd.venue_override ?? sd.show?.venue;
                  const confirmedMain = confirmedMainByDate.get(sd.id) ?? 0;
                  return (
                    <TableRow
                      key={sd.id}
                      className="cursor-pointer"
                      onClick={() => setActiveShowDateId(sd.id)}
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {format(new Date(sd.date + 'T00:00:00'), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{dayAbbr(sd.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {sd.start_time ? sd.start_time.slice(0, 5) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{sd.show?.program || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{sd.show?.sub_program || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{venue || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{sd.city?.name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {config
                          ? <span>{confirmedMain}/{config.main_cast} <span className="text-muted-foreground">+ {config.understudies} u/s</span></span>
                          : <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_STYLE[status]}>
                          {STATUS_LABEL[status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
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
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setActiveShowDateId(it.showDate.id)}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{showLabel(it.showDate.show)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[it.showDate.venue_override ?? it.showDate.show?.venue, it.showDate.city?.name]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge variant="secondary" className={STATUS_STYLE[derivedStatus(it.showDate)]}>
                  {STATUS_LABEL[derivedStatus(it.showDate)]}
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
