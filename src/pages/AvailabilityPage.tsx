import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useFeature } from '@/hooks/useEntitlements';
import { useArtistEligibleDates } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { useMyHireOrders } from '@/hooks/useHireOrders';
import { UnlinkedArtistCard } from '@/components/artists/UnlinkedArtistCard';
import { CalendarSurface } from '@/components/calendar/surface/CalendarSurface';
import { toArtistEntries, type ArtistBookingStatus } from '@/lib/calendar/artistData';
import type { ArtistDateEntry, ArtistStatus } from '@/lib/calendar/types';
import { respondToOffer } from '@/data/bookings';
import { fetchMyActiveBookedDates } from '@/data/artists';
import { acceptConsequenceNote } from '@/lib/bookings/actionCopy';
import { formatDateDMY, formatDayMonthShortYear, parseDateOnly, toDateKey } from '@/lib/dates';
import { useBookingFlow, useFlowTimes } from '@/hooks/useBookingFlow';
import { BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { describeTonightStandalone } from '@/lib/bookings/timingCopy';
import { DEFAULT_FLOW_TIMES } from '@/data/settings';
import { availabilityPageCopy, bookingStatusLabels } from '@/lib/flowCopy';
import { useToast } from '@/hooks/use-toast';
import { useRailDismissed } from '@/components/setup/useRailDismissed';
import { PageMini } from '@/components/minis/PageMini';

export default function AvailabilityPage() {
  return <ArtistAvailability />;
}

type ArtistLens = 'offers' | 'month' | 'all-dates';

/* ============================================================
 * Artist view — calendar surface (Offers/Month/All dates) + blocked dates
 * ============================================================ */
function ArtistAvailability() {
  const { t } = useTranslation('availability');
  const { t: tFlow } = useTranslation('flowCopy');
  const { t: tBooking } = useTranslation('bookingCopy');
  const { currentOrg } = useAuth();
  // Mark that the artist has seen their availability. This completes the dashboard
  // first-run "block dates" step for an open-calendar artist: nothing to block is a
  // valid end state, so opening this page counts as handling it (see
  // useArtistOnboardingStatus). Per-org, localStorage-backed, harmless for non-artists.
  const [, markAvailabilityVisited] = useRailDismissed('artistVisitedAvailability', currentOrg?.id ?? null);
  useEffect(() => { markAvailabilityVisited(); }, [markAvailabilityVisited]);
  const { data: artist } = useMyArtist();
  const { data: eligibleDates, isLoading } = useArtistEligibleDates();
  const hireOrdersEnabled = useFeature('hire_orders');
  const bookingFlowEnabled = useFeature('booking_flow');
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const orgId = currentOrg?.id ?? null;
  // Org-scope discipline mirrors FirstOfferCard: `flowQ.data` (passed straight
  // through, not the page's `flow` fallback below) stays undefined while there is
  // no active org or the query hasn't settled yet, and describeTonight already
  // returns null for an unread flow — so an org-less mount narrates nothing, with
  // no separate `orgId ? … : null` guard needed here.
  const timesQ = useFlowTimes(orgId);
  const tonight = describeTonightStandalone(timesQ.data ?? DEFAULT_FLOW_TIMES, flowQ.data, tBooking);
  // Audience gate: describeTonight also composes a confirmation-digest sentence for
  // a direct-book org (artist_acceptance: false) whenever confirmation_digest is
  // true — the BOOKING_FLOW_DEFAULTS/"direct"-preset value — but that sentence is
  // about a DIFFERENT audience (already-confirmed artists), not R2.1/R4.7's response
  // window. Only artists who actually receive offers see this line.
  const showTiming = flow.artist_acceptance && !!tonight;
  const pageCopy = availabilityPageCopy(flow, tFlow);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // The Offers lens is the artist role's Phase-1 default in CalendarSurface, so
  // the dashboard's `?filter=unanswered` deep link (ArtistDashboard's stage-chain
  // CTAs, see ROUTES.AVAILABILITY?filter=unanswered) already lands there — both a
  // bare visit and the filtered deep link open on the same actionable queue. An
  // explicit `?lens=` still takes priority when present (deep-linking straight to
  // Month/All dates), matching ShowsBookingsPage's `?status=`/`?lens=` handling.
  const [lens, setLens] = useState<ArtistLens>('offers');
  useEffect(() => {
    const lensParam = searchParams.get('lens');
    if (lensParam === 'offers' || lensParam === 'month' || lensParam === 'all-dates') {
      setLens(lensParam);
    } else if (searchParams.get('filter') === 'unanswered') {
      setLens('offers');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const updateLens = (key: string) => {
    setLens(key as ArtistLens);
    const next = new URLSearchParams(searchParams);
    next.set('lens', key);
    setSearchParams(next, { replace: true });
  };

  // Flow-aware artist status wording (e.g. a direct-booking org's "Not booked"
  // instead of the fixed ARTIST_TONES "Not offered"). `blocked` has no
  // flow-aware equivalent, so it's left out and falls back to the tone default.
  const statusLabels: Partial<Record<ArtistStatus, string>> = useMemo(() => {
    const labels = bookingStatusLabels(flow, tFlow);
    return {
      confirmed: labels.confirmed,
      soft_booked: labels.soft_booked,
      suggested: labels.suggested,
      unanswered: labels.unanswered,
    };
  }, [flow, tFlow]);

  // NOTE: distinct cache key from the other artist-bookings queries. This one
  // selects `id` (required to accept/decline an offer); ArtistDashboard and
  // ArtistBookingsView select narrower, id-less shapes. React Query caches by
  // key (not by `select`), so sharing one key let an id-less projection clobber
  // this slot — OfferResponseButtons then fired `update().eq('id', undefined)`.
  // Keep one key per projection.
  const { data: myBookings, isError: bookingsError } = useQuery({
    queryKey: ['bookings', 'artist-offers', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, show_date_id, status, offer_expires_at')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as { id: string; show_date_id: string; status: string; offer_expires_at: string | null }[];
    },
  });

  const statusByDateId = useMemo(() => {
    const m = new Map<string, ArtistBookingStatus>();
    myBookings?.forEach((b) => m.set(b.show_date_id, { bookingId: b.id, status: b.status, offerExpiresAt: b.offer_expires_at }));
    return m;
  }, [myBookings]);

  type BlockedDateRow = { id: string; date: string; reason: string | null };

  const { data: blockedDates, isError: blockedError } = useQuery({
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

  const blockedSet = useMemo(
    () => new Set((blockedDates ?? []).map((b) => b.date)),
    [blockedDates]
  );

  // Dates the artist may block: eligible dates (server-enforced by the
  // blocked_dates trigger) that aren't already blocked and have no active
  // booking. Keeps the picker in lockstep with the DB guard so a legitimate
  // choice is never rejected and an ineligible one can't be submitted.
  const blockableDates = useMemo(() => {
    const seen = new Set<string>();
    return (eligibleDates ?? [])
      .filter((d) => {
        if (blockedSet.has(d.date)) return false;
        const booking = statusByDateId.get(d.id);
        if (booking && booking.status !== 'cancelled') return false;
        if (seen.has(d.date)) return false;
        seen.add(d.date);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [eligibleDates, blockedSet, statusByDateId]);

  // show_date_id -> issued/countersigned hire order id for this artist
  // (useMyHireOrders never returns any other status). First-seen wins so a
  // stray duplicate keeps the most recent order (the query orders DESC). Kept
  // empty while the module is off, matching ArtistBookingsView's gate.
  const { data: myHireOrders } = useMyHireOrders();
  const hireOrderByDateId = useMemo(() => {
    const m = new Map<string, string>();
    if (!hireOrdersEnabled) return m;
    myHireOrders?.forEach((o) => {
      if (o.show_date_id && !m.has(o.show_date_id)) m.set(o.show_date_id, o.id);
    });
    return m;
  }, [myHireOrders, hireOrdersEnabled]);

  // Past (and any other out-of-eligible-window) active bookings — merged into
  // `artistEntries` below so a booking whose show_date `useArtistEligibleDates`
  // silently drops (it's upcoming-only) still renders, with its hire-order
  // link intact. Mirrors ArtistBookingsView's identical query + gate.
  const { data: activeBookedDates } = useQuery({
    queryKey: ['bookings', 'artist-active-booked', artist?.id],
    enabled: !!artist?.id && bookingFlowEnabled,
    queryFn: () => fetchMyActiveBookedDates(supabase, artist!.id),
  });

  const pastBookedEntries = useMemo<ArtistDateEntry[]>(
    () =>
      (activeBookedDates ?? []).map((b) => ({
        id: b.id,
        date: parseDateOnly(b.date),
        bookingId: null,
        program: b.show?.program ?? '',
        subProgram: b.show?.sub_program ?? null,
        venue: b.venue,
        city: null,
        session1: b.session_1,
        myStatus: b.status as ArtistStatus,
        hireOrderId: hireOrderByDateId.get(b.id) ?? null,
      })),
    [activeBookedDates, hireOrderByDateId]
  );

  const artistEntries = useMemo(() => {
    const eligibleEntries = toArtistEntries(eligibleDates ?? [], statusByDateId, blockedSet, hireOrderByDateId);
    const seen = new Set(eligibleEntries.map((e) => e.id));
    return [...eligibleEntries, ...pastBookedEntries.filter((e) => !seen.has(e.id))];
  }, [eligibleDates, statusByDateId, blockedSet, hireOrderByDateId, pastBookedEntries]);

  // Auto-confirm on accept when the org's flow skips producer confirmation —
  // mirrors OfferResponseButtons' derivation (same default-true fallback).
  const autoConfirm = !flow.producer_confirmation;

  const respond = useMutation({
    mutationFn: (args: { bookingId: string; accept: boolean }) =>
      respondToOffer(supabase, { bookingId: args.bookingId, accept: args.accept, now: new Date(), autoConfirm }),
    onSuccess: ({ affected }, args) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast({
          title: t('offer.toast.unavailableTitle'),
          description: t('offer.toast.unavailableDesc'),
          variant: 'destructive',
        });
        return;
      }
      if (args.accept) {
        const note = acceptConsequenceNote(flowQ.data, tBooking);
        toast({ title: note.title, description: note.description });
      } else {
        toast({
          title: t('offer.toast.declinedTitle'),
          description: t('offer.toast.declinedDesc'),
        });
      }
    },
    onError: (e: Error) => toast({ title: t('offer.toast.errorTitle'), description: e.message, variant: 'destructive' }),
  });

  const addBlock = useMutation({
    mutationFn: async (args: { date: string; reason: string | null }) => {
      if (!currentOrg) throw new Error(t('error.noOrg'));
      const { error } = await supabase.from('blocked_dates').insert({
        artist_id: artist!.id,
        date: args.date,
        reason: args.reason,
        org_id: currentOrg.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      setNewBlockDate('');
      setNewBlockReason('');
      toast({ title: t('toast.dateBlocked') });
    },
    onError: (e: Error) => toast({ title: t('toast.errorTitle'), description: e.message, variant: 'destructive' }),
  });

  const removeBlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blocked_dates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      toast({ title: t('toast.blockRemoved') });
    },
  });

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{pageCopy.title}</h1>
        <UnlinkedArtistCard orgName={currentOrg?.name} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{pageCopy.title}</h1>
        <p className="text-muted-foreground mt-1">{pageCopy.subtitle}</p>
      </div>

      <PageMini page="availability" />

      {bookingsError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('offersLoadError')}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : artistEntries.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">{t('emptyAll')}</div>
      ) : (
        <CalendarSurface
          role="artist"
          artistEntries={artistEntries}
          lens={lens}
          onLensChange={updateLens}
          statusLabels={statusLabels}
          actions={{
            accept: (bookingId) => respond.mutate({ bookingId, accept: true }),
            decline: (bookingId) => respond.mutate({ bookingId, accept: false }),
            block: (_dateId, date) => addBlock.mutate({ date: toDateKey(date), reason: null }),
          }}
        />
      )}

      {/* Blocked dates — vacation / conflict windows */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">{t('blocked.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('blocked.description')}
          </p>
          {showTiming && (
            <p data-testid="availability-timing" className="text-xs text-muted-foreground mt-1">{tonight}</p>
          )}

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newBlockDate) addBlock.mutate({ date: newBlockDate, reason: newBlockReason || null });
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">{t('blocked.dateLabel')}</Label>
              {/* Eligible-only picker: mirrors the server-side blocked_dates
                  guard so artists can't submit an ineligible date or one they're
                  already booked on. */}
              <select
                aria-label={t('blocked.selectAriaLabel')}
                className="flex h-10 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={newBlockDate}
                onChange={(e) => setNewBlockDate(e.target.value)}
                disabled={blockableDates.length === 0}
                required
              >
                <option value="" disabled>
                  {blockableDates.length === 0 ? t('blocked.noEligibleOption') : t('blocked.selectPlaceholder')}
                </option>
                {blockableDates.map((d) => (
                  <option key={d.id} value={d.date}>
                    {formatDateDMY(d.date)}
                    {d.venue ? ` — ${d.venue}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 flex-1 min-w-32">
              <Label className="text-xs">{t('blocked.reasonLabel')}</Label>
              <Input
                placeholder={t('blocked.reasonPlaceholder')}
                value={newBlockReason}
                onChange={(e) => setNewBlockReason(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!newBlockDate || addBlock.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />{t('blocked.blockButton')}
            </Button>
          </form>

          {blockedError && (
            <Alert variant="destructive">
              <AlertDescription>{t('blocked.loadError')}</AlertDescription>
            </Alert>
          )}

          {(blockedDates?.length ?? 0) > 0 && (
            <div className="space-y-1.5 pt-1">
              {blockedDates!.map((b) => (
                <div key={b.id} className="flex items-center gap-3 text-sm p-2 rounded-md border border-border">
                  <span className="font-medium w-28 shrink-0">
                    {formatDayMonthShortYear(b.date)}
                  </span>
                  <span className="flex-1 text-muted-foreground">{b.reason ?? '—'}</span>
                  <IconTooltip label={t('blocked.removeTooltip')}>
                    <button
                      onClick={() => removeBlock.mutate(b.id)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      aria-label={t('blocked.removeTooltip')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </IconTooltip>
                </div>
              ))}
            </div>
          )}
          {!blockedError && (blockedDates?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground pt-1">{t('blocked.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
