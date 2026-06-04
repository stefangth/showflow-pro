import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, addMonths, subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { useAuth } from '@/features/auth/AuthContext';
import { useArtistEligibleDates } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { ArtistAvailabilityCalendar } from '@/components/availability/ArtistAvailabilityCalendar';
import { AvailabilityPicker } from '@/components/availability/AvailabilityPicker';
import { OfferResponseButtons } from '@/components/availability/OfferResponseButtons';
import { formatDateDMY, parseDateOnly } from '@/lib/dates';
import { showLabel } from '@/types';
import { useColumnTemplate, useEditorConfig } from '@/features/editor/EditorContext';
import { useColumnHeaders } from '@/features/editor/useColumnHeaders';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';
import { useToast } from '@/hooks/use-toast';

const BOOKING_STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  soft_booked: 'Hold placed',
  suggested: 'Offer pending',
  unanswered: 'No offer yet',
};

const BOOKING_STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-success/10 text-success',
  soft_booked: 'bg-warning/10 text-warning',
  suggested: 'bg-info/10 text-info',
  unanswered: 'bg-muted text-muted-foreground',
};

export default function AvailabilityPage() {
  return <ArtistAvailability />;
}

/* ============================================================
 * Artist view — eligibility-scoped list + calendar + blocked dates
 * ============================================================ */
function ArtistAvailability() {
  const { currentOrg } = useAuth();
  const { data: artist } = useMyArtist();
  const { data: eligibleDates, isLoading } = useArtistEligibleDates();
  const { orderedColumns, visibleCount } = useColumnTemplate('availability');
  const { isEditorMode } = useEditorConfig();
  const columnHeaders = useColumnHeaders(orderedColumns);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

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

  const { data: myBookings } = useQuery({
    queryKey: ['bookings', 'artist-all', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('id, show_date_id, status')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      return (data ?? []) as { id: string; show_date_id: string; status: string }[];
    },
  });

  const bookingMap = useMemo(() => {
    const m = new Map<string, { id: string; status: string }>();
    myBookings?.forEach((b) => m.set(b.show_date_id, { id: b.id, status: b.status }));
    return m;
  }, [myBookings]);

  const statusFor = (dateId: string): string => bookingMap.get(dateId)?.status ?? 'unanswered';

  const respondedSet = useMemo(
    () => new Set(
      [...bookingMap.entries()]
        .filter(([, b]) => b.status === 'confirmed' || b.status === 'soft_booked')
        .map(([id]) => id)
    ),
    [bookingMap]
  );

  const qc = useQueryClient();

  type BlockedDateRow = { id: string; date: string; reason: string | null };

  const { data: blockedDates } = useQuery({
    queryKey: ['blocked-dates', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_dates')
        .select('id, date, reason')
        .eq('artist_id', artist!.id)
        .order('date');
      if (error) throw error;
      return (data ?? []) as BlockedDateRow[];
    },
  });

  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');

  const addBlock = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error('No active organization');
      const { error } = await supabase.from('blocked_dates').insert({
        artist_id: artist!.id,
        date: newBlockDate,
        reason: newBlockReason || null,
        org_id: currentOrg.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      setNewBlockDate('');
      setNewBlockReason('');
      toast({ title: 'Date blocked' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const removeBlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blocked_dates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      toast({ title: 'Block removed' });
    },
  });

  const filtered = useMemo(() => {
    let list = (eligibleDates ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    if (filter === 'unanswered') list = list.filter((d) => !respondedSet.has(d.id));
    return applySort(list, sort, (d) => showLabel(d.show), (d) => parseDateOnly(d.date));
  }, [eligibleDates, timeframe, sort, filter, respondedSet]);

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">My Offers</h1>
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
        <h1 className="font-display text-[32px] font-semibold tracking-tight">My Offers</h1>
        <p className="text-muted-foreground mt-1">
          View your offers and block dates you're unavailable for.
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
                  {columnHeaders.map(({ columnId, headerLabel }) => (
                    <TableHead key={columnId} className={isEditorMode ? 'font-mono text-xs' : 'text-xs'}>
                      {headerLabel}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const status = statusFor(d.id);
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
                      case '_computed.my_status': return (
                        <TableCell key={colId}>
                          <Badge variant="secondary" className={BOOKING_STATUS_STYLE[status] ?? ''}>
                            {BOOKING_STATUS_LABEL[status] ?? status}
                          </Badge>
                        </TableCell>
                      );
                      case '_computed.blocked': {
                        const booking = bookingMap.get(d.id);
                        if (booking?.status === 'suggested') {
                          return (
                            <TableCell key={colId} className="w-48">
                              <OfferResponseButtons bookingId={booking.id} size="sm" />
                            </TableCell>
                          );
                        }
                        if (booking?.status === 'soft_booked' || booking?.status === 'confirmed') {
                          return (
                            <TableCell key={colId} className="w-36 text-muted-foreground text-xs">—</TableCell>
                          );
                        }
                        return (
                          <TableCell key={colId} className="w-36">
                            <AvailabilityPicker artistId={artist.id} date={d.date} size="sm" />
                          </TableCell>
                        );
                      }
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

      {/* Blocked dates — vacation / conflict windows */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Blocked Dates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Mark dates you're unavailable so the system won't send you offers for those days.
          </p>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newBlockDate) addBlock.mutate();
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="w-44"
                value={newBlockDate}
                onChange={(e) => setNewBlockDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1 flex-1 min-w-32">
              <Label className="text-xs">Reason (optional)</Label>
              <Input
                placeholder="Vacation, other work…"
                value={newBlockReason}
                onChange={(e) => setNewBlockReason(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!newBlockDate || addBlock.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />Block
            </Button>
          </form>

          {(blockedDates?.length ?? 0) > 0 && (
            <div className="space-y-1.5 pt-1">
              {blockedDates!.map((b) => (
                <div key={b.id} className="flex items-center gap-3 text-sm p-2 rounded-md border border-border">
                  <span className="font-medium w-28 shrink-0">
                    {new Date(b.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="flex-1 text-muted-foreground">{b.reason ?? '—'}</span>
                  <button
                    onClick={() => removeBlock.mutate(b.id)}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                    aria-label="Remove block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {(blockedDates?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground pt-1">No blocked dates yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
