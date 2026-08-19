import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { toast } from 'sonner';
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
import { formatDateDMY, parseDateOnly, pastRowClassName, dfLocale } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow';
import { referenceLabel, BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { artistMeter } from '@/lib/flowCopy';
import { ROUTES } from '@/config/app.config';
import type { OrderData } from '@/lib/hireOrders/types';
import { UnlinkedArtistCard } from '@/components/artists/UnlinkedArtistCard';
import { respondToOffer } from '@/data/bookings';
import { acceptConsequenceNote } from '@/lib/bookings/actionCopy';
import { termLabel } from '@/i18n/terms';
import type { Lang } from '@/i18n/config';

type BookingLite = { id: string; show_date_id: string; status: string; offer_expires_at: string | null };
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
  const { t, i18n } = useTranslation('dashboard');
  const { t: tFlow } = useTranslation('flowCopy');
  const { t: tAvail } = useTranslation('availability');
  const { t: tBookingCopy } = useTranslation('bookingCopy');
  const { data: artist } = useMyArtist();
  const { data: eligibleDates } = useArtistEligibleDates();
  const { reference, customFieldKey } = useReferenceField();
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const meter = artistMeter(flow, tFlow);
  const lang: Lang = i18n.language?.startsWith('de') ? 'de' : 'en';

  const hireOrdersEnabled = useFeature('hire_orders');
  const bookingFlowEnabled = useFeature('booking_flow');
  const { data: myHireOrders, isSuccess: hireOrdersLoaded } = useMyHireOrders();
  const { currentOrg } = useAuth();
  const hireOrderAction = useHireOrderAction();
  const qc = useQueryClient();

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
        .select('id, show_date_id, status, offer_expires_at')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  // Accept/decline a pending offer straight from the dashboard's hero card.
  // `autoConfirm` mirrors AvailabilityPage's OffersLens derivation: when the org's
  // flow skips producer confirmation, accepting writes straight to `confirmed`.
  const respond = useMutation({
    mutationFn: (args: { bookingId: string; accept: boolean }) =>
      respondToOffer(supabase, {
        bookingId: args.bookingId,
        accept: args.accept,
        now: new Date(),
        autoConfirm: !flow.producer_confirmation,
      }),
    onSuccess: ({ affected }, args) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast.error(tAvail('offer.toast.unavailableTitle'), { description: tAvail('offer.toast.unavailableDesc') });
        return;
      }
      if (args.accept) {
        const note = acceptConsequenceNote(flow, tBookingCopy);
        toast.success(note.title, { description: note.description });
      } else {
        toast.success(tAvail('offer.toast.declinedTitle'), { description: tAvail('offer.toast.declinedDesc') });
      }
    },
    onError: (e: Error) => toast.error(tAvail('offer.toast.errorTitle'), { description: e.message }),
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

  // Suggested (still-pending) offers, keyed by show_date_id, carrying the booking id
  // (needed to accept/decline) and the response deadline for the "Answer by" label.
  const suggestedByDateId = useMemo(() => {
    const m = new Map<string, { bookingId: string; expiresAt: string | null }>();
    myBookings?.forEach((b) => {
      if (b.status === 'suggested') m.set(b.show_date_id, { bookingId: b.id, expiresAt: b.offer_expires_at });
    });
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
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{t('artist.heading')}</h1>
        <UnlinkedArtistCard orgName={currentOrg?.name} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
          <div>
            <h1 className="font-display text-[32px] font-semibold tracking-tight">{t('artist.heading')}</h1>
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
                <AlertDescription>{t('artist.offersLoadError')}</AlertDescription>
              </Alert>
            )}

            <div className="max-w-md">
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
                        {t('artist.respondedOfTotal', { responded, total })}
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
            </div>

            {/* Direct-booking orgs have no offer step, so there is never anything
                to respond to; hide the card instead of showing offer language. */}
            {flow.artist_acceptance && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display flex items-center gap-2 text-base">
                    <MessageCircleQuestion className="h-4 w-4" />
                    {t('artist.awaitingResponse')}
                    <Badge variant="secondary">{unanswered.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {unanswered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('artist.allCaughtUp')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {unanswered.slice(0, 3).map((d) => {
                        const offer = suggestedByDateId.get(d.id);
                        const date = parseDateOnly(d.date);
                        const deadline = offer?.expiresAt
                          ? `${termLabel('responseWindow', lang)} ${format(new Date(offer.expiresAt), 'EEE HH:mm', { locale: dfLocale() })}`
                          : null;
                        return (
                          <div
                            key={d.id}
                            className="flex items-stretch overflow-hidden rounded-[14px] border border-border bg-card shadow-elev2"
                          >
                            <div className="flex w-[92px] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-border bg-accent-50 py-5">
                              <p className="m-0 text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-text">
                                {format(date, 'EEE', { locale: dfLocale() })}
                              </p>
                              <p className="m-0 font-mono text-[28px] font-semibold leading-8 text-accent-text">
                                {format(date, 'd', { locale: dfLocale() })}
                              </p>
                              <p className="m-0 text-[11px] text-muted-foreground">
                                {format(date, 'MMM', { locale: dfLocale() })}
                              </p>
                            </div>
                            <div className="min-w-0 flex-1 p-5">
                              <p className="m-0 text-[19px] font-semibold tracking-[-0.2px]">
                                {referenceLabel({ reference, show: d.show, custom: d.custom, customFieldKey })}
                              </p>
                              <p className="m-0 mt-1 text-[13.5px] text-muted-foreground">{formatDateDMY(d.date)}</p>
                              <p className="m-0 mt-3.5 text-sm leading-[21px]">
                                {t('artist.offer.question')}{' '}
                                <strong>
                                  {flow.producer_confirmation
                                    ? t('artist.offer.acceptNoteConfirm')
                                    : t('artist.offer.acceptNote')}
                                </strong>{' '}
                                {tAvail('offer.toast.declinedDesc')}
                              </p>
                              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                                <Button
                                  type="button"
                                  disabled={!offer || respond.isPending}
                                  onClick={() => offer && respond.mutate({ bookingId: offer.bookingId, accept: true })}
                                >
                                  {tAvail('offer.accept')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={!offer || respond.isPending}
                                  onClick={() => offer && respond.mutate({ bookingId: offer.bookingId, accept: false })}
                                >
                                  {tAvail('offer.decline')}
                                </Button>
                                {deadline && (
                                  <span className="ml-1.5 font-mono text-xs text-warning">{deadline}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {unanswered.length > 3 && (
                        <Link
                          to={`${ROUTES.AVAILABILITY}?filter=unanswered`}
                          className="block text-center text-xs text-muted-foreground pt-1"
                        >
                          {t('artist.unansweredMore', { count: unanswered.length - 3 })}
                        </Link>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </ModuleGate>

          {hireOrdersEnabled && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  {t('artist.hireOrdersTitle')}
                  {(myHireOrders?.length ?? 0) > 0 && (
                    <Badge variant="secondary">{myHireOrders!.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(myHireOrders?.length ?? 0) === 0 ? (
                  // Only the genuinely-empty case (the query actually SUCCEEDED and
                  // returned no orders) shows the zero-state. Gating on isSuccess rather
                  // than !isLoading also covers the disabled-query window: TanStack v5
                  // reports isLoading:false while useMyHireOrders is disabled waiting on
                  // useMyArtist, so an artist who has orders never flashes "no paperwork"
                  // and a pending/failed fetch is never mistaken for empty.
                  hireOrdersLoaded ? (
                    <p className="text-sm text-muted-foreground">
                      {t('artist.hireOrdersEmpty')}
                    </p>
                  ) : null
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
                            aria-label={t('artist.download')}
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
                {t('artist.myCasts')}
                {(myMemberships?.length ?? 0) > 0 && (
                  <Badge variant="secondary">{myMemberships!.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {membershipsError ? (
                <p className="text-sm text-destructive">{t('artist.castsLoadError')}</p>
              ) : (myMemberships?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t('artist.noCastsYet')}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {myMemberships!.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2 rounded-md border border-border">
                      <p className="text-sm font-medium">{m.cast?.name ?? '—'}</p>
                      <Badge variant="outline" className="text-xs">{t('artist.member')}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
    </div>
  );
}
