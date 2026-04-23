import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ShowDetailSheet } from '@/components/shows/ShowDetailSheet';
import { ArtistBookingsView } from '@/components/bookings/ArtistBookingsView';

type ShowDateLite = {
  id: string;
  date: string;
  start_time: string | null;
  status: string;
};

type ShowRow = {
  id: string;
  title: string;
  description: string | null;
  venue: string | null;
  category: string | null;
  program: string | null;
  sub_program: string | null;
  status: 'active' | 'archived' | 'draft';
  slots_per_date: number;
  created_at: string;
  show_dates: ShowDateLite[];
};

type BookingLite = { show_date_id: string; status: string };

type DerivedStatus = 'cast_confirmed' | 'cast_pending' | 'open' | 'cancelled' | 'none';

const STATUS_LABEL: Record<DerivedStatus, string> = {
  cast_confirmed: 'Cast Confirmed',
  cast_pending: 'Cast Pending',
  open: 'Open',
  cancelled: 'Cancelled',
  none: '—',
};

const STATUS_STYLE: Record<DerivedStatus, string> = {
  cast_confirmed: 'bg-success/10 text-success',
  cast_pending: 'bg-warning/10 text-warning',
  open: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  none: 'bg-muted text-muted-foreground',
};

export default function ShowsBookingsPage() {
  const { hasRole } = useAuth();

  // Artist-only users get a scoped view; admins/producers keep producer view.
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistBookingsView />;
  }

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canSee } = useFilterVisibility('bookings');
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [statusFilter, setStatusFilter] = useState<'all' | DerivedStatus>('all');
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', venue: '', category: '', program: '', sub_program: '', slots_per_date: 1,
  });

  // Read initial filters from URL params (deep links from dashboard cards)
  useEffect(() => {
    const status = searchParams.get('status');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (status && ['cast_confirmed', 'cast_pending', 'open', 'cancelled'].includes(status)) {
      setStatusFilter(status as DerivedStatus);
    }
    if (from || to) {
      setTimeframe({
        from: from ? parseISO(from) : null,
        to: to ? parseISO(to) : null,
      });
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: shows, isLoading } = useQuery({
    queryKey: ['shows-bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shows')
        .select('*, show_dates(id, date, start_time, status)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ShowRow[];
    },
  });

  const { data: bookings } = useQuery({
    queryKey: ['shows-bookings-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('show_date_id, status')
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  const createShow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('shows').insert({
        title: form.title,
        description: form.description || null,
        venue: form.venue || null,
        category: form.category || null,
        program: form.program || null,
        sub_program: form.sub_program || null,
        slots_per_date: form.slots_per_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shows-bookings'] });
      setDialogOpen(false);
      setForm({ title: '', description: '', venue: '', category: '', program: '', sub_program: '', slots_per_date: 1 });
      toast({ title: 'Show created' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  // Confirmed bookings count per show_date
  const confirmedByDate = useMemo(() => {
    const map = new Map<string, number>();
    (bookings ?? []).forEach(b => {
      if (b.status === 'confirmed') {
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

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const nextDateFor = (s: ShowRow): ShowDateLite | null => {
    const upcoming = (s.show_dates ?? [])
      .filter(d => new Date(d.date + 'T00:00:00') >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? null;
  };

  const derivedStatus = (s: ShowRow): DerivedStatus => {
    const next = nextDateFor(s);
    if (!next) return 'none';
    if (next.status === 'cancelled') return 'cancelled';
    const confirmed = confirmedByDate.get(next.id) ?? 0;
    if (confirmed >= s.slots_per_date) return 'cast_confirmed';
    if (anyBookingByDate.has(next.id)) return 'cast_pending';
    return 'open';
  };

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    shows?.forEach(s => s.program && set.add(s.program));
    return Array.from(set).sort();
  }, [shows]);

  const filtered = useMemo(() => {
    if (!shows) return [];
    let list = shows.filter(s =>
      (search === '' ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.venue?.toLowerCase().includes(search.toLowerCase()) ||
        s.program?.toLowerCase().includes(search.toLowerCase()) ||
        s.sub_program?.toLowerCase().includes(search.toLowerCase())) &&
      (programs.length === 0 || (s.program && programs.includes(s.program)))
    );
    if (timeframe.from || timeframe.to) {
      list = list.filter(s => s.show_dates.some(d => inTimeframe(new Date(d.date + 'T00:00:00'), timeframe)));
    }
    if (statusFilter !== 'all') {
      list = list.filter(s => derivedStatus(s) === statusFilter);
    }
    return applySort(list, sort, s => s.title, s => {
      const n = nextDateFor(s);
      return n ? new Date(n.date + 'T00:00:00') : null;
    });
  }, [shows, search, programs, timeframe, statusFilter, sort, confirmedByDate, anyBookingByDate]);

  const calendarItems = useMemo(() => {
    return filtered.flatMap(s => s.show_dates.map(d => ({ show: s, date: new Date(d.date + 'T00:00:00') })));
  }, [filtered]);

  const showStatusStyle: Record<string, string> = {
    active: 'bg-success/10 text-success',
    draft: 'bg-muted text-muted-foreground',
    archived: 'bg-destructive/10 text-destructive',
  };

  const updateStatusFilter = (v: 'all' | DerivedStatus) => {
    setStatusFilter(v);
    const next = new URLSearchParams(searchParams);
    if (v === 'all') next.delete('status'); else next.set('status', v);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Shows &amp; Bookings</h1>
          <p className="text-muted-foreground mt-1">All shows, their next dates and cast status in one place.</p>
        </div>
        {(hasRole('admin') || hasRole('producer')) && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Show</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Create New Show</DialogTitle>
              </DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createShow.mutate(); }} className="space-y-4">
                <Input placeholder="Show title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
                <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                <Input placeholder="Venue" value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} />
                <Input placeholder="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
                <Input placeholder="Program (e.g. Candlelight)" value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value }))} />
                <Input placeholder="Sub Program" value={form.sub_program} onChange={e => setForm(f => ({ ...f, sub_program: e.target.value }))} />
                <div className="space-y-1">
                  <label className="text-sm font-medium">Slots per date</label>
                  <Input type="number" min={1} value={form.slots_per_date} onChange={e => setForm(f => ({ ...f, slots_per_date: parseInt(e.target.value) || 1 }))} />
                </div>
                <Button type="submit" className="w-full" disabled={createShow.isPending}>
                  {createShow.isPending ? 'Creating...' : 'Create Show'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search shows, venue, program…" value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {canSee('status') && (
          <Select value={statusFilter} onValueChange={(v) => updateStatusFilter(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="cast_confirmed">Cast Confirmed</SelectItem>
              <SelectItem value="cast_pending">Cast Pending</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Next date" />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
      ) : view === 'list' ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Sub Program</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Booking Status</TableHead>
                  <TableHead>Show 1</TableHead>
                  <TableHead>Show 2</TableHead>
                  <TableHead>Show 3</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s => {
                  const next = nextDateFor(s);
                  const status = derivedStatus(s);
                  // First 3 start_times for the next show date (single show date can have multiple performances?
                  // Schema has a single start_time per show_date — so we surface up to 3 upcoming dates' start_times instead.
                  const upcoming = (s.show_dates ?? [])
                    .filter(d => new Date(d.date + 'T00:00:00') >= today)
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .slice(0, 3);
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => setActiveShowId(s.id)}
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {next ? format(new Date(next.date + 'T00:00:00'), 'dd/MM/yyyy') : '—'}
                      </TableCell>
                      <TableCell>{s.program || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{s.sub_program || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{s.venue || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_STYLE[status]}>
                          {STATUS_LABEL[status]}
                        </Badge>
                      </TableCell>
                      {[0, 1, 2].map(i => (
                        <TableCell key={i} className="whitespace-nowrap text-sm">
                          {upcoming[i]?.start_time
                            ? upcoming[i].start_time!.slice(0, 5)
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      No shows match the current filters.
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
          getDate={(it) => it.date}
          emptyMessage="No shows scheduled"
          renderItem={(it) => (
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setActiveShowId(it.show.id)}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{it.show.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {it.show.venue ?? ''}{it.show.program ? ` • ${it.show.program}` : ''}
                  </p>
                </div>
                <Badge variant="secondary" className={showStatusStyle[it.show.status] ?? ''}>{it.show.status}</Badge>
              </CardContent>
            </Card>
          )}
        />
      )}

      <ShowDetailSheet
        showId={activeShowId}
        open={!!activeShowId}
        onOpenChange={(o) => { if (!o) setActiveShowId(null); }}
      />
    </div>
  );
}
