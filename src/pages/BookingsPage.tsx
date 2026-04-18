import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';

export default function BookingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canSee } = useFilterVisibility('bookings');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('chrono_desc');
  const [view, setView] = useState<ViewMode>('list');

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['all-bookings', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bookings')
        .select('*, artist:artists(name), show_date:show_dates(date, start_time, show:shows(title, venue, program))')
        .order('created_at', { ascending: false })
        .limit(500);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter as 'suggested' | 'soft_booked' | 'confirmed' | 'cancelled');
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
      const { error } = await supabase.from('bookings').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bookings'] });
      toast({ title: 'Booking updated' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    bookings?.forEach((b: any) => b.show_date?.show?.program && set.add(b.show_date.show.program));
    return Array.from(set).sort();
  }, [bookings]);

  const filtered = useMemo(() => {
    if (!bookings) return [];
    let list = (bookings as any[]).filter(b =>
      (search === '' ||
        b.artist?.name?.toLowerCase().includes(search.toLowerCase()) ||
        b.show_date?.show?.title?.toLowerCase().includes(search.toLowerCase())) &&
      (programs.length === 0 || (b.show_date?.show?.program && programs.includes(b.show_date.show.program)))
    );
    if (timeframe.from || timeframe.to) {
      list = list.filter(b => inTimeframe(b.show_date?.date ? new Date(b.show_date.date + 'T00:00:00') : null, timeframe));
    }
    return applySort(
      list,
      sort,
      b => b.artist?.name ?? '',
      b => b.show_date?.date ? new Date(b.show_date.date + 'T00:00:00') : null,
    );
  }, [bookings, search, programs, timeframe, sort]);

  const statusColor: Record<string, string> = {
    suggested: 'bg-info/10 text-info',
    soft_booked: 'bg-warning/10 text-warning',
    confirmed: 'bg-success/10 text-success',
    cancelled: 'bg-destructive/10 text-destructive',
  };

  const renderBooking = (b: any) => (
    <Card>
      <CardContent className="py-4 flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <p className="font-medium">{b.artist?.name ?? 'Unknown'}</p>
            <Badge variant="secondary" className={statusColor[b.status] ?? ''}>{b.status.replace('_', ' ')}</Badge>
            {b.is_understudy && <Badge variant="outline" className="text-xs">Understudy</Badge>}
            {b.show_date?.show?.program && <Badge variant="outline" className="text-xs">{b.show_date.show.program}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {b.show_date?.show?.title} — {b.show_date?.date ? format(new Date(b.show_date.date), 'MMM d, yyyy') : ''}
            {b.show_date?.show?.venue ? ` @ ${b.show_date.show.venue}` : ''}
          </p>
        </div>
        {b.status !== 'cancelled' && b.status !== 'confirmed' && (
          <div className="flex gap-2">
            {b.status === 'soft_booked' && (
              <Button size="sm" onClick={() => updateStatus.mutate({ id: b.id, status: 'confirmed' })}>Confirm</Button>
            )}
            {b.status === 'suggested' && (
              <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: 'soft_booked' })}>Soft Book</Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus.mutate({ id: b.id, status: 'cancelled' })}>Cancel</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Bookings</h1>
          <p className="text-muted-foreground mt-1">View and manage all bookings</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search artist or show..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {canSee('status') && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="suggested">Suggested</SelectItem>
              <SelectItem value="soft_booked">Soft Booked</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Show date" />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : view === 'list' ? (
        <div className="space-y-3">
          {filtered.map((b: any) => <div key={b.id}>{renderBooking(b)}</div>)}
          {filtered.length === 0 && <p className="text-muted-foreground text-center py-12">No bookings found</p>}
        </div>
      ) : (
        <EntityCalendar
          items={filtered}
          getDate={(b: any) => b.show_date?.date ? new Date(b.show_date.date + 'T00:00:00') : null}
          emptyMessage="No bookings"
          renderItem={(b: any) => renderBooking(b)}
        />
      )}
    </div>
  );
}
