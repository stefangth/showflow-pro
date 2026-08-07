import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TimeframeFilter, upcomingTimeframe, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';
import { useArtistEligibleDates, type EligibleDate } from '@/hooks/useArtistEligibleDates';
import {
  fetchMyCancelledDateBookings, mergeArtistCancelledDates, type CancelledDateEntry,
  fetchMyActiveBookedDates, mergeArtistActiveBookedDates, type ActiveBookedDateEntry,
} from '@/data/artists';
import { useMyArtist } from '@/hooks/useMyArtist';
import { useMyHireOrders } from '@/hooks/useHireOrders';
import { useFeature } from '@/hooks/useEntitlements';
import { ModuleGate } from '@/components/layout/ModuleGate';
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow';
import { bookingStatusBadgeClass } from '@/lib/bookings';
import { BOOKING_FLOW_DEFAULTS, referenceLabel } from '@/lib/bookingFlow';
import { bookingsViewCopy, bookingStatusLabels } from '@/lib/flowCopy';
import { formatDateDMY, parseDateOnly, pastRowClassName } from '@/lib/dates';
import { showIdentityLabel } from '@/types';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/config/app.config';
import { useColumnTemplate, useEditorConfig } from '@/features/editor/EditorContext';
import { useColumnHeaders } from '@/features/editor/useColumnHeaders';
import { ColumnLayoutEditor } from '@/features/editor/ColumnLayoutEditor';

type BookingLite = { show_date_id: string; status: string; is_understudy: boolean };

/**
 * A row in the artist Bookings view: an eligible (upcoming) date, a cancelled
 * one the artist was booked on, or an active booking merged in from
 * `fetchMyActiveBookedDates` whose show_date fell outside the eligible-dates
 * window (typically a past date — see the July 31 bug this merge fixes).
 */
type DateRow = EligibleDate | CancelledDateEntry | ActiveBookedDateEntry;

/** True when the row is a cancelled date the artist had been booked on. */
function isCancelledEntry(d: DateRow): d is CancelledDateEntry {
  return d.status === 'cancelled';
}

/** True when the row came from the active-booked merge rather than eligibleDates/cancelledEntries.
 *  Keys on the explicit `kind: 'active-booked'` discriminant `fetchMyActiveBookedDates`
 *  stamps on every row, not a coincidental field name: an earlier version of this guard
 *  checked `'is_understudy' in d`, which would silently misclassify an eligible-date row
 *  the moment `EligibleDate` ever grew a field of that name. Exported for its own direct
 *  unit test (ArtistBookingsView.rowGuard.test.ts). */
// eslint-disable-next-line react-refresh/only-export-components -- pure type guard, not a component; kept beside the DateRow union it discriminates.
export function isActiveBookedEntry(d: DateRow): d is ActiveBookedDateEntry {
  return 'kind' in d && d.kind === 'active-booked';
}

/** CancelledDateEntry's and ActiveBookedDateEntry's queries never select `custom`
 *  (neither is reference-field aware), so only pass it through for eligible-date rows. */
function customFor(d: DateRow): Record<string, unknown> | null {
  return 'custom' in d ? d.custom : null;
}

/**
 * Artist-scoped Bookings view: same list/calendar UI, filtered to eligible dates.
 */
export function ArtistBookingsView() {
  const { data: artist } = useMyArtist();
  const { data: eligibleDates, isLoading } = useArtistEligibleDates();
  const hireOrdersEnabled = useFeature('hire_orders');
  const bookingFlowEnabled = useFeature('booking_flow');
  const { data: myHireOrders } = useMyHireOrders();
  const { reference, customFieldKey } = useReferenceField();
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const pageCopy = bookingsViewCopy(flow);
  const statusLabels = bookingStatusLabels(flow);
  const { orderedColumns, visibleCount } = useColumnTemplate('bookings-artist');
  const { isEditorMode } = useEditorConfig();
  const columnHeaders = useColumnHeaders(orderedColumns);
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => upcomingTimeframe());
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);

  const { data: cancelledEntries } = useQuery({
    queryKey: ['bookings', 'artist-cancelled', artist?.id],
    enabled: !!artist?.id && bookingFlowEnabled,
    queryFn: () => fetchMyCancelledDateBookings(supabase, artist!.id),
  });

  // Past (and any other out-of-eligible-window) active bookings — merged below
  // so a booking whose show_date useArtistEligibleDates silently drops (it's
  // upcoming-only) still renders. This is the July 31 fix. It also supersedes
  // a dedicated `myBookings` query this view used to run in parallel: that
  // query's own select (`show_date_id, status, is_understudy`, `.neq('status',
  // 'cancelled')`) is a strict subset of this one's, so `bookingByDateId` below
  // is derived straight from this single read instead of firing a second,
  // near-identical one on every mount.
  const { data: activeBookedDates, isError: bookingsError } = useQuery({
    queryKey: ['bookings', 'artist-active-booked', artist?.id],
    enabled: !!artist?.id && bookingFlowEnabled,
    queryFn: () => fetchMyActiveBookedDates(supabase, artist!.id),
  });

  // `ActiveBookedDateEntry.id` IS the show_date id (see data/artists.ts), so it
  // doubles as the lookup key `statusFor` needs for eligible (upcoming) rows --
  // no separate flat query required.
  const bookingByDateId = useMemo(() => {
    const m = new Map<string, BookingLite>();
    activeBookedDates?.forEach((b) =>
      m.set(b.id, { show_date_id: b.id, status: b.status, is_understudy: b.is_understudy })
    );
    return m;
  }, [activeBookedDates]);

  // show_date_id -> issued/countersigned hire order id for this artist
  // (useMyHireOrders never returns any other status). First-seen wins so a
  // stray duplicate keeps the most recent order (the query orders DESC).
  const hireOrderIdByDateId = useMemo(() => {
    const m = new Map<string, string>();
    myHireOrders?.forEach((o) => {
      if (o.show_date_id && !m.has(o.show_date_id)) m.set(o.show_date_id, o.id);
    });
    return m;
  }, [myHireOrders]);

  const statusFor = (d: DateRow): string => {
    if (isCancelledEntry(d)) return 'cancelled';
    if (isActiveBookedEntry(d)) return d.status;
    const b = bookingByDateId.get(d.id);
    return b ? b.status : 'unanswered';
  };

  const filtered = useMemo<DateRow[]>(() => {
    const eligibleFiltered = (eligibleDates ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    const cancelledFiltered = (cancelledEntries ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    const activeBookedFiltered = (activeBookedDates ?? []).filter((d) =>
      inTimeframe(parseDateOnly(d.date), timeframe)
    );
    const merged = mergeArtistCancelledDates(eligibleFiltered, cancelledFiltered);
    const withActiveBooked = mergeArtistActiveBookedDates(merged, activeBookedFiltered);
    // Sort on the show's own program/sub_program identity (stable), never the
    // org-configurable reference label used for display below.
    return applySort(
      withActiveBooked,
      sort,
      (d) => showIdentityLabel(d.show),
      (d) => parseDateOnly(d.date)
    );
  }, [eligibleDates, cancelledEntries, activeBookedDates, timeframe, sort]);

  const calendarItems = useMemo(
    () => filtered.map((d) => ({ date: parseDateOnly(d.date), eligible: d })),
    [filtered]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{pageCopy.title}</h1>
        <p className="text-muted-foreground mt-1">{pageCopy.subtitle}</p>
      </div>

      <ModuleGate feature="booking_flow">
        {/* Inside the gate: these controls filter, sort and lay out the eligible-date
            table below, which does not exist at all without the booking module. */}
        <div className="flex flex-wrap items-center gap-3">
          <TimeframeFilter value={timeframe} onChange={setTimeframe} />
          <SortControl value={sort} onChange={setSort} chronoLabel="Date" />
          <div className="ml-auto">
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        <ColumnLayoutEditor pageKey="bookings-artist" />

        {bookingsError ? (
          <Alert variant="destructive">
            <AlertDescription>Failed to load your bookings. Please refresh.</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
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
                    const status = statusFor(d);
                    const cancelled = isCancelledEntry(d);
                    const cellFor = (colId: string) => {
                      switch (colId) {
                        case 'show_dates.date': return (
                          <TableCell key={colId} className="font-medium whitespace-nowrap">
                            {formatDateDMY(d.date)}
                          </TableCell>
                        );
                        case 'shows.program': return (
                          <TableCell key={colId}>
                            {d.show
                              ? referenceLabel({ reference, show: d.show, custom: customFor(d), customFieldKey })
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                        case 'shows.sub_program': return (
                          <TableCell key={colId}>{d.show?.sub_program ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        );
                        case 'show_dates.venue': return (
                          <TableCell key={colId}>
                            {d.venue || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                        case 'show_dates.session_1': return (
                          <TableCell key={colId} className="whitespace-nowrap">
                            {d.session_1 ? d.session_1.slice(0, 5) : '—'}
                          </TableCell>
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
                            <Badge variant="secondary" className={bookingStatusBadgeClass(status)}>
                              {statusLabels[status] ?? status}
                            </Badge>
                            {cancelled && d.cancellation_reason && (
                              <div className="mt-1 text-xs text-destructive">{d.cancellation_reason}</div>
                            )}
                            {hireOrdersEnabled && hireOrderIdByDateId.has(d.id) && (
                              <Link
                                to={ROUTES.HIRE_ORDER_DETAIL.replace(':id', hireOrderIdByDateId.get(d.id)!)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <FileText className="h-3 w-3" />
                                Hire order
                              </Link>
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
                        key={d.id}
                        className={cn('cursor-pointer', pastRowClassName(parseDateOnly(d.date)))}
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
              const d = it.eligible;
              const status = statusFor(d);
              const cancelled = isCancelledEntry(d);
              return (
                <Card
                  className={cn(
                    'hover:shadow-elev2 transition-shadow cursor-pointer',
                    pastRowClassName(it.date),
                  )}
                  onClick={() => setActiveShowDateId(d.id)}
                >
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {d.show
                          ? referenceLabel({ reference, show: d.show, custom: customFor(d), customFieldKey })
                          : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {d.venue ?? ''}
                        {d.session_1 ? ` • ${d.session_1.slice(0, 5)}` : ''}
                      </p>
                      {cancelled && d.cancellation_reason && (
                        <p className="text-xs text-destructive truncate">{d.cancellation_reason}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className={bookingStatusBadgeClass(status)}>
                      {statusLabels[status] ?? status}
                    </Badge>
                  </CardContent>
                </Card>
              );
            }}
          />
        )}
      </ModuleGate>

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
