import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, addMonths, subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { useArtistEligibleDates } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { ArtistAvailabilityCalendar } from '@/components/availability/ArtistAvailabilityCalendar';
import { AvailabilityPicker } from '@/components/availability/AvailabilityPicker';
import { formatDateDMY, parseDateOnly } from '@/lib/dates';
import { showLabel } from '@/types';
import { useColumnTemplate } from '@/features/editor/EditorContext';
import { pageColumnDefs } from '@/features/editor/columnRegistries';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';

export default function AvailabilityPage() {
  const { hasRole } = useAuth();
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistAvailability />;
  }
  return <ProducerAvailability />;
}

/* ============================================================
 * Artist view — eligibility-scoped list + calendar
 * ============================================================ */
function ArtistAvailability() {
  const { data: artist } = useMyArtist();
  const { data: eligibleDates, isLoading } = useArtistEligibleDates();
  const { orderedColumns, visibleCount } = useColumnTemplate('availability');
  const colDefs = pageColumnDefs('availability');
  const [searchParams, setSearchParams] = useSearchParams();

  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [filter, setFilter] = useState<'all' | 'unanswered'>(
    (searchParams.get('filter') as any) === 'unanswered' ? 'unanswered' : 'all'
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filter === 'unanswered') next.set('filter', 'unanswered');
    else next.delete('filter');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const { data: myAvailability } = useQuery({
    queryKey: ['availability', 'artist-all', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('availability')
        .select('date, status')
        .eq('artist_id', artist!.id);
      return (data ?? []) as { date: string; status: string }[];
    },
  });

  const respondedSet = useMemo(
    () => new Set((myAvailability ?? []).map((a) => a.date)),
    [myAvailability]
  );

  const filtered = useMemo(() => {
    let list = (eligibleDates ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    if (filter === 'unanswered') list = list.filter((d) => !respondedSet.has(d.date));
    return applySort(list, sort, (d) => showLabel(d.show), (d) => parseDateOnly(d.date));
  }, [eligibleDates, timeframe, sort, filter, respondedSet]);

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Availability</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No artist profile linked to your account. Ask an admin to link your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">My Availability</h1>
        <p className="text-muted-foreground mt-1">
          Respond to dates you've been offered. Bold blue outline = offered, red = not available, green = confirmed.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-input p-0.5">
          {(['all', 'unanswered'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-sm capitalize ${
                filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'all' ? 'All offers' : 'Unanswered'}
            </button>
          ))}
        </div>
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
        <SortControl value={sort} onChange={setSort} chronoLabel="Date" />
        <div className="ml-auto">
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <ColumnLayoutEditor pageKey="availability" />

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded bg-muted animate-pulse" />
          ))}
        </div>
      ) : view === 'list' ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {orderedColumns
                    .filter(c => c.visible)
                    .map(c => {
                      const def = colDefs.find(d => d.id === c.columnId);
                      return (
                        <TableHead
                          key={c.columnId}
                          className={`font-mono text-xs ${c.columnId === 'availability.status' ? 'w-56' : ''}`}
                        >
                          {def?.column ?? c.columnId}
                        </TableHead>
                      );
                    })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const cellFor = (colId: string) => {
                    switch (colId) {
                      case 'show_dates.date': return (
                        <TableCell key={colId} className="font-medium whitespace-nowrap">
                          {formatDateDMY(d.date)}
                        </TableCell>
                      );
                      case 'shows.program': return <TableCell key={colId}>{showLabel(d.show)}</TableCell>;
                      case 'shows.sub_program': return (
                        <TableCell key={colId}>
                          {d.show?.sub_program ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                      case 'show_dates.venue': return (
                        <TableCell key={colId}>
                          {d.venue || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                      case 'show_dates.session_1': return (
                        <TableCell key={colId} className="whitespace-nowrap">{d.session_1.slice(0, 5)}</TableCell>
                      );
                      case 'show_dates.session_2': return (
                        <TableCell key={colId} className="whitespace-nowrap">
                          {d.session_2 ? d.session_2.slice(0, 5) : '—'}
                        </TableCell>
                      );
                      case 'show_dates.session_3': return (
                        <TableCell key={colId} className="whitespace-nowrap">
                          {d.session_3 ? d.session_3.slice(0, 5) : '—'}
                        </TableCell>
                      );
                      case 'availability.status': return (
                        <TableCell key={colId}>
                          <AvailabilityPicker artistId={artist.id} date={d.date} size="sm" />
                        </TableCell>
                      );
                      default: return (
                        <TableCell key={colId} className="text-xs text-muted-foreground">—</TableCell>
                      );
                    }
                  };
                  return (
                    <TableRow key={d.id}>
                      {orderedColumns.filter(c => c.visible).map(c => cellFor(c.columnId))}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleCount || 5} className="text-center text-muted-foreground py-12">
                      {filter === 'unanswered'
                        ? 'No unanswered offers — great work!'
                        : 'No eligible dates yet.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <ArtistAvailabilityCalendar
          artistId={artist.id}
          eligibleDates={eligibleDates ?? []}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Producer / Admin view — original month grid (own availability)
 * ============================================================ */
function ProducerAvailability() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data: artist } = useQuery({
    queryKey: ['my-artist-producer', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('artists')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const { data: availability } = useQuery({
    queryKey: ['availability', 'producer', artist?.id, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data } = await supabase
        .from('availability')
        .select('*')
        .eq('artist_id', artist!.id)
        .gte('date', format(monthStart, 'yyyy-MM-dd'))
        .lte('date', format(monthEnd, 'yyyy-MM-dd'));
      return data ?? [];
    },
    enabled: !!artist,
  });

  const toggle = useMutation({
    mutationFn: async (date: string) => {
      const existing = availability?.find((a) => a.date === date);
      if (existing) {
        const cycle = { available: 'unavailable', unavailable: 'tentative', tentative: 'delete' } as const;
        const next = cycle[existing.status as keyof typeof cycle] ?? 'delete';
        if (next === 'delete') {
          await supabase.from('availability').delete().eq('id', existing.id);
        } else {
          await supabase
            .from('availability')
            .update({ status: next as 'available' | 'unavailable' | 'tentative' })
            .eq('id', existing.id);
        }
      } else {
        await supabase.from('availability').insert({ artist_id: artist!.id, date, status: 'available' });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['availability'] }),
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const availMap = useMemo(() => {
    const map: Record<string, string> = {};
    availability?.forEach((a) => (map[a.date] = a.status));
    return map;
  }, [availability]);

  const statusStyles: Record<string, string> = {
    available: 'bg-success/20 border-success text-success hover:bg-success/30',
    unavailable: 'bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30',
    tentative: 'bg-warning/20 border-warning text-warning hover:bg-warning/30',
  };

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Availability</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No artist profile linked to your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">My Availability</h1>
        <p className="text-muted-foreground mt-1">
          Click dates to toggle: available → unavailable → tentative → clear
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="font-display">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {/* Monday-based leading pad: Mon=0, …, Sun=6 */}
            {Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const status = availMap[dateStr];
              return (
                <button
                  key={dateStr}
                  onClick={() => toggle.mutate(dateStr)}
                  className={`relative p-2 rounded-lg border text-center min-h-[60px] transition-colors ${
                    status ? statusStyles[status] : 'border-border hover:bg-muted'
                  } ${isToday(day) ? 'ring-2 ring-primary' : ''}`}
                >
                  <span className={`text-sm ${isToday(day) ? 'font-bold' : ''}`}>{format(day, 'd')}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
            <span className="text-xs text-muted-foreground">Legend:</span>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-success/30" /><span className="text-xs">Available</span></div>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-destructive/30" /><span className="text-xs">Unavailable</span></div>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-warning/30" /><span className="text-xs">Tentative</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* Suppress unused warning for badge import we may want later */
void Badge;
