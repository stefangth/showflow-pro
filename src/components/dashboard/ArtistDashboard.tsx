import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CalendarDays, Download, FileText, MessageCircleQuestion, Theater } from 'lucide-react';
import { useArtistEligibleDates } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { useMyHireOrders, useHireOrderAction } from '@/hooks/useHireOrders';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { useFeature } from '@/hooks/useEntitlements';
import { ModuleGate } from '@/components/layout/ModuleGate';
import { useAuth } from '@/features/auth/AuthContext';
import { formatDateDMY, parseDateOnly, pastRowClassName } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow';
import { referenceLabel, BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { artistMeter } from '@/lib/flowCopy';
import { ROUTES } from '@/config/app.config';
import type { OrderData } from '@/lib/hireOrders/types';
import { useDashboardFirstRun } from '@/components/dashboard/firstRun/useDashboardFirstRun';
import { DashboardWelcome } from '@/components/dashboard/firstRun/DashboardWelcome';
import { DashboardWelcomeCollapsed } from '@/components/dashboard/firstRun/DashboardWelcomeCollapsed';
import { DashboardSetupRail } from '@/components/dashboard/firstRun/DashboardSetupRail';

type BookingLite = { show_date_id: string; status: string };
type CastMembershipRow = { id: string; cast: { id: string; name: string } | null };

/** Read a resolved snapshot field as a trimmed string ("" when absent). Mirrors
 *  the same small helper in HireOrderDetailPage.tsx / HireOrdersCard.tsx (kept
 *  local per that established pattern rather than a shared import). */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Artist dashboard: offer response rate + list of pending offers.
 */
export function ArtistDashboard() {
  const { data: artist } = useMyArtist();
  const { data: eligibleDates } = useArtistEligibleDates();
  const { reference, customFieldKey } = useReferenceField();
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const meter = artistMeter(flow);

  const hireOrdersEnabled = useFeature('hire_orders');
  const bookingFlowEnabled = useFeature('booking_flow');
  const { data: myHireOrders } = useMyHireOrders();
  const { currentOrg } = useAuth();
  const hireOrderAction = useHireOrderAction();
  const fr = useDashboardFirstRun('artist');

  function handleDownloadHireOrder(orderId: string) {
    void (async () => {
      const res = await hireOrderAction.mutateAsync({
        action: 'download-url',
        org_id: currentOrg?.id ?? '',
        order_id: orderId,
      });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    })().catch(() => {
      /* useHireOrderAction toasts the failure */
    });
  }

  // Distinct cache key per projection (this selects no `id`). A shared key let
  // different `select` shapes clobber each other in the React Query cache — see
  // the note in AvailabilityPage.
  const { data: myBookings, isError: bookingsError } = useQuery({
    queryKey: ['bookings', 'artist-dashboard', artist?.id],
    // Module-gated: without booking_flow the offers region never renders, so this
    // read would be discarded on every dashboard load.
    enabled: !!artist?.id && bookingFlowEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('show_date_id, status')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  const { data: myMemberships, isError: membershipsError } = useQuery({
    queryKey: ['my-cast-memberships', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_members')
        .select('id, cast:casts(id, name)')
        .eq('artist_id', artist!.id);
      if (error) throw error;
      return (data ?? []) as unknown as CastMembershipRow[];
    },
  });

  const bookingMap = useMemo(() => {
    const m = new Map<string, string>();
    myBookings?.forEach((b) => m.set(b.show_date_id, b.status));
    return m;
  }, [myBookings]);

  const { responded, total, pct, unanswered } = useMemo(() => {
    const dates = eligibleDates ?? [];
    const total = dates.length;
    const respondedCount = dates.filter((d) => {
      const s = bookingMap.get(d.id);
      return s != null && meter.countStatuses.includes(s);
    }).length;
    return {
      total,
      responded: respondedCount,
      pct: total === 0 ? 0 : Math.round((respondedCount / total) * 100),
      unanswered: dates.filter((d) => bookingMap.get(d.id) === 'suggested'),
    };
  }, [eligibleDates, bookingMap, meter]);

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Dashboard</h1>
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
      {fr.show &&
        (fr.dismissed ? (
          <DashboardWelcomeCollapsed
            label={fr.collapsedLabel}
            hint={fr.collapsedHint}
            ctaLabel={fr.collapsedCta}
            onOpen={fr.openRail}
          />
        ) : (
          <DashboardWelcome welcome={fr.welcome} onPrimary={fr.openRail} onSecondary={fr.dismiss} />
        ))}

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="space-y-6">
            <div>
              <h1 className="font-display text-[32px] font-semibold tracking-tight">Dashboard</h1>
              {/* Stays in the heading block so it reads as a subtitle (mt-1, not the
                  parent's space-y-6), but still module-gated: the sentence describes the
                  offer pipeline ("your response rate on dates you've been offered"),
                  which does not run at all without the module. Gated with a bare
                  conditional rather than ModuleGate so the page shows one notice, not two. */}
              {bookingFlowEnabled && (
                <p className="text-muted-foreground mt-1">{meter.headerSentence}</p>
              )}
            </div>

            <ModuleGate feature="booking_flow">
              {bookingsError && (
                <Alert variant="destructive">
                  <AlertDescription>Failed to load your offers. Please refresh.</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link
                  to={meter.filterUnanswered ? `${ROUTES.AVAILABILITY}?filter=unanswered` : ROUTES.AVAILABILITY}
                  className="block"
                >
                  <Card className="hover:shadow-elev3 transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <p className="text-sm text-muted-foreground font-medium">{meter.title}</p>
                        <CalendarDays className="h-8 w-8 text-primary opacity-30" />
                      </div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <p className="text-[36px] font-display font-semibold tracking-tight">{pct}%</p>
                        <p className="text-sm text-muted-foreground">
                          {responded} of {total} dates
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        {meter.footer}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">{meter.explainer}</p>
                    </CardContent>
                  </Card>
                </Link>

                {/* Direct-booking orgs have no offer step, so there is never anything
                    to respond to; hide the card instead of showing offer language. */}
                {flow.artist_acceptance && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display flex items-center gap-2 text-base">
                      <MessageCircleQuestion className="h-4 w-4" />
                      Awaiting your response
                      <Badge variant="secondary">{unanswered.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {unanswered.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        You're all caught up. No pending offers.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {unanswered.slice(0, 8).map((d) => (
                          <Link
                            key={d.id}
                            to={`${ROUTES.AVAILABILITY}?filter=unanswered`}
                            className="flex items-center justify-between p-2 rounded-md hover:bg-muted text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {referenceLabel({ reference, show: d.show, custom: d.custom, customFieldKey })}
                              </p>
                              <p className="text-xs text-muted-foreground">{formatDateDMY(d.date)}</p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              Respond
                            </Badge>
                          </Link>
                        ))}
                        {unanswered.length > 8 && (
                          <p className="text-xs text-muted-foreground text-center pt-1">
                            +{unanswered.length - 8} more
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                )}
              </div>
            </ModuleGate>

            {hireOrdersEnabled && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" />
                    Your hire orders
                    {(myHireOrders?.length ?? 0) > 0 && (
                      <Badge variant="secondary">{myHireOrders!.length}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(myHireOrders?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Your booking paperwork shows up here. When a producer sends you a hire
                      order, it arrives by email and you can review and sign it here.
                    </p>
                  ) : (
                    myHireOrders!.map((o) => {
                      const data = (o.data ?? {}) as OrderData;
                      const dateStr = snap(data, 'date');
                      const venue = snap(data, 'venue');
                      const subtitle = [dateStr ? formatDateDMY(dateStr) : null, venue || null]
                        .filter(Boolean)
                        .join(' · ');
                      // dateStr is a resolved snapshot field, not always a clean YYYY-MM-DD
                      // (see snap()) -- guard the shape before treating it as a date.
                      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? parseDateOnly(dateStr) : null;
                      return (
                        <div
                          key={o.id}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-lg border border-border p-3',
                            pastRowClassName(parsedDate),
                          )}
                        >
                          <Link to={ROUTES.HIRE_ORDER_DETAIL.replace(':id', o.id)} className="min-w-0 flex-1">
                            <p className="text-sm font-mono font-medium text-foreground truncate">{o.order_no}</p>
                            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                          </Link>
                          <div className="flex items-center gap-2 shrink-0">
                            <HireOrderStatusBadge status={o.status} />
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label="Download"
                              onClick={() => handleDownloadHireOrder(o.id)}
                              disabled={hireOrderAction.isPending}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2 text-base">
                  <Theater className="h-4 w-4" />
                  My Casts
                  {(myMemberships?.length ?? 0) > 0 && (
                    <Badge variant="secondary">{myMemberships!.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {membershipsError ? (
                  <p className="text-sm text-destructive">Failed to load your casts.</p>
                ) : (myMemberships?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">You haven't been added to any casts yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {myMemberships!.map(m => (
                      <div key={m.id} className="flex items-center justify-between p-2 rounded-md border border-border">
                        <p className="text-sm font-medium">{m.cast?.name ?? '—'}</p>
                        <Badge variant="outline" className="text-xs">Member</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {fr.show && fr.railOpen && (
          <DashboardSetupRail
            eyebrow={fr.railEyebrow}
            title={fr.railTitle}
            body={fr.railBody}
            complete={fr.complete}
            steps={fr.steps}
            rules={fr.rules}
            offFooters={fr.offFooters}
            onClose={fr.closeRail}
            onDismiss={fr.dismiss}
          />
        )}
      </div>
    </div>
  );
}
