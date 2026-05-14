import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';
import { useArtistEligibleDates, type EligibleDate } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { formatDateDMY, parseDateOnly } from '@/lib/dates';
import { showLabel } from '@/types';
import { useColumnTemplate } from '@/features/editor/EditorContext';
import { pageColumnDefs } from '@/features/editor/columnRegistries';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';

type BookingLite = { show_date_id: string; status: string; is_understudy: boolean };
type AvailLite = { date: string; status: 'available' | 'unavailable' | 'tentative' };

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  soft_booked: 'Soft booked',
  suggested: 'Suggested',
  unavailable: 'Not available',
  tentative: 'Tentative',
  available: 'Available',
  unanswered: 'Unanswered',
};

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-success/10 text-success',
  soft_booked: 'bg-warning/10 text-warning',
  suggested: 'bg-info/10 text-info',
  unavailable: 'bg-destructive/10 text-destructive',
  tentative: 'bg-warning/10 text-warning',
  available: 'bg-success/10 text-success',
  unanswered: 'bg-muted text-muted-foreground',
};

/**
 * Artist-scoped Bookings view: same list/calendar UI, filtered to eligible dates.
 */
export function ArtistBookingsView() {
  const { data: artist } = useMyArtist();
  const { data: eligibleDates, isLoading } = useArtistEligibleDates();
  const { orderedColumns, visibleCount } = useColumnTemplate('bookings-artist');
  const colDefs = pageColumnDefs('bookings-artist');
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);

  const { data: myBookings } = useQuery({
    queryKey: ['bookings', 'artist-all', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('show_date_id, status, is_understudy')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      return (data ?? []) as BookingLite[];
    },
  });

  const { data: myAvailability } = useQuery({
    queryKey: ['availability', 'artist-all', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('availability')
        .select('date, status')
        .eq('artist_id', artist!.id);
      return (data ?? []) as AvailLite[];
    },
  });

  const bookingByDateId = useMemo(() => {
    const m = new Map<string, BookingLite>();
    myBookings?.forEach((b) => m.set(b.show_date_id, b));
    return m;
  }, [myBookings]);

  const availByDate = useMemo(() => {
    const m = new Map<string, AvailLite['status']>();
    myAvailability?.forEach((a) => m.set(a.date, a.status));
    return m;
  }, [myAvailability]);

  /** Per-date status: booking takes precedence, then availability, else unanswered. */
  const statusFor = (d: EligibleDate): string => {
    const b = bookingByDateId.get(d.id);
    if (b) return b.status;
    const a = availByDate.get(d.date);
    if (a) return a;
    return 'unanswered';
  };

  const filtered = useMemo(() => {
    const list = (eligibleDates ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    return applySort(
      list,
      sort,
      (d) => showLabel(d.show),
      (d) => parseDateOnly(d.date)
    );
  }, [eligibleDates, timeframe, sort]);

  const calendarItems = useMemo(
    () => filtered.map((d) => ({ date: parseDateOnly(d.date), eligible: d })),
    [filtered]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">My Bookings</h1>
        <p className="text-muted-foreground mt-1">
          Dates you've been offered for, based on your cast eligibility.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
        <SortControl value={sort} onChange={setSort} chronoLabel="Date" />
        <div className="ml-auto">
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <ColumnLayoutEditor pageKey="bookings-artist" />

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
                        <TableHead key={c.columnId} className="font-mono text-xs">
                          {def?.column ?? c.columnId}
                        </TableHead>
                      );
                    })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const status = statusFor(d);
                  const cellFor = (colId: string) => {
                    switch (colId) {
                      case 'show_dates.date': return (
                        <TableCell key={colId} className="font-medium whitespace-nowrap">
                          {formatDateDMY(d.date)}
                        </TableCell>
                      );
                      case 'shows.program': return <TableCell key={colId}>{showLabel(d.show)}</TableCell>;
                      case 'shows.sub_program': return (
                        <TableCell key={colId}>{d.show?.sub_program ?? <span className="text-muted-foreground">—</span>}</TableCell>
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
                          <Badge variant="secondary" className={STATUS_STYLE[status] ?? ''}>
                            {STATUS_LABEL[status] ?? status}
                          </Badge>
                        </TableCell>
                      );
                      default: return (
                        <TableCell key={colId} className="text-xs text-muted-foreground">—</TableCell>
                      );
                    }
                  };
                  return (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => setActiveShowDateId(d.id)}
                    >
                      {orderedColumns.filter(c => c.visible).map(c => cellFor(c.columnId))}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleCount || 5} className="text-center text-muted-foreground py-12">
                      No eligible dates yet. Once you're added to a cast, offered dates appear here.
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
          emptyMessage="No eligible dates"
          renderItem={(it) => {
            const status = statusFor(it.eligible);
            return (
              <Card
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setActiveShowDateId(it.eligible.id)}
              >
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{showLabel(it.eligible.show)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {it.eligible.venue ?? ''}
                      {it.eligible.session_1 ? ` • ${it.eligible.session_1.slice(0, 5)}` : ''}
                    </p>
                  </div>
                  <Badge variant="secondary" className={STATUS_STYLE[status] ?? ''}>
                    {STATUS_LABEL[status] ?? status}
                  </Badge>
                </CardContent>
              </Card>
            );
          }}
        />
      )}

      <ShowDateDetailSheet
        showDateId={activeShowDateId}
        open={!!activeShowDateId}
        onOpenChange={(o) => {
          if (!o) setActiveShowDateId(null);
        }}
      />
    </div>
  );
}
