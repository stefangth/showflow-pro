import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchCasts } from '@/data/casts';
import { fetchActiveArtistOptions } from '@/data/artists';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Clock, Users, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEligibleArtists } from '@/hooks/useEligibleArtists';
import { useSkills } from '@/hooks/useSkills';
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow';
import { showSlots } from '@/lib/settings';
import {
  deriveBookingGroups, computeInheritedCastIds,
  offerResultToast, closeResultToast, deriveDirectBookList,
} from '@/lib/bookings';
import { computeUpNext } from '@/lib/bookingCockpit';
import { BOOKING_FLOW_DEFAULTS, referenceLabel, type FlowTimes } from '@/lib/bookingFlow';
import { BOOKING_ENGINE_DEFAULTS } from '@/config/app.config';
import { formatDateDMY, parseDateOnly } from '@/lib/dates';
import {
  openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier,
  dryRunOfferTier, createBooking, updateBookingStatusGuarded,
} from '@/data/bookings';
import {
  fetchRequiredSkillIds, fetchSkillEligibleArtistIds, addShowDateRequiredSkill, removeShowDateRequiredSkill,
} from '@/data/eligibility';
import { unionSkillIds } from '@/lib/eligibility';
import { resolveOrgSetting } from '@/data/settings';
import { BookingFunnel } from '@/components/shows/date/BookingFunnel';
import { UpNextStrip } from '@/components/shows/date/UpNextStrip';
import { TierTimeline } from '@/components/shows/date/TierTimeline';
import { DryRunDialog } from '@/components/shows/date/DryRunDialog';
import { EligibilityBookList } from '@/components/shows/date/EligibilityBookList';
import { RequiredSkillsSection } from '@/components/shows/date/RequiredSkillsSection';
import { fetchBlockedArtistIds } from '@/data/blockedDates';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { HireOrdersCard } from '@/components/shows/hireOrders/HireOrdersCard';
import { useHireOrdersForDate, useHireOrderAction } from '@/hooks/useHireOrders';
import { useFeature } from '@/hooks/useEntitlements';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { BookingRow } from '@/components/shows/BookingRow';
import { useCancelShowDate, useDeleteShowDate } from '@/hooks/useShowDates';
import { useAllCities } from '@/hooks/useAllCities';
import { isSyncedDate, canHardDeleteDate } from '@/lib/catalog';
import { ModuleGate } from '@/components/layout/ModuleGate';
import type { Booking, Artist } from '@/types';

interface Props {
  showDateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BookingWithArtist = Booking & { artist: Pick<Artist, 'id' | 'name'> };

/** The assigned-artists card: the sheet's single cast surface. `canManage=false`
 *  renders every row without its Confirm/Cancel controls, which is exactly the
 *  shape the locked module preview needs. */
function AssignedArtistsCard({ bookings, canManage, showConfirm, onConfirm, onCancel }: {
  bookings: BookingWithArtist[];
  canManage: boolean;
  showConfirm: boolean;
  onConfirm: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}) {
  // Memoized: this card re-renders with the whole sheet, and the grouping is the
  // same sort/filter work the sheet already memoizes for bookedArtistIds.
  const { active, main, understudy } = useMemo(() => deriveBookingGroups(bookings), [bookings]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />Assigned Artists
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length > 0 ? (
          <div className="space-y-4">
            {main.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Main cast</p>
                {main.map(b => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    canManage={canManage}
                    // Gated on confirm_bookings: false hides just the Confirm action
                    // (Cancel stays available under the broad canManage read/manage gate).
                    showConfirm={showConfirm}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                  />
                ))}
              </div>
            )}
            {understudy.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Understudies</p>
                {understudy.map(b => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    canManage={canManage}
                    showConfirm={showConfirm}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No artists assigned yet</p>
        )}
      </CardContent>
    </Card>
  );
}

/** The sheet's whole booking region, behind one module gate.
 *
 *  Entitled: the offers / direct-book UI passed as children, followed by the live
 *  assigned-artists card with its Confirm/Cancel controls.
 *
 *  Not entitled: a single module notice plus the SAME assigned-artists card rendered
 *  read-only. One gate and one cast rendering on purpose — an ungated second copy of
 *  the cast both duplicated the list and left a Cancel button whose write the RLS
 *  floor would reject with a misleading "this booking changed" toast. */
export function BookingCardSection({
  bookings, canManage, showConfirm, onConfirm, onCancel, children,
}: {
  bookings: BookingWithArtist[];
  canManage: boolean;
  showConfirm: boolean;
  onConfirm: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
  children: ReactNode;
}) {
  const noop = () => {};
  // The preview exists so a frozen cast stays readable. With no cast there is
  // nothing to keep readable, so the notice stands alone rather than being
  // followed by a card whose only content is "No artists assigned yet".
  const hasCast = deriveBookingGroups(bookings).active.length > 0;
  return (
    <ModuleGate
      feature="booking_flow"
      preview={hasCast ? (
        <AssignedArtistsCard
          bookings={bookings}
          canManage={false}
          showConfirm={false}
          onConfirm={noop}
          onCancel={noop}
        />
      ) : undefined}
    >
      {children}
      <AssignedArtistsCard
        bookings={bookings}
        canManage={canManage}
        showConfirm={showConfirm}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </ModuleGate>
  );
}

/** Joined row shape of the show-date-detail select below — mirror the select string. */
interface ShowDateDetailRow {
  id: string;
  date: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  status: string;
  notes: string | null;
  city_id: string | null;
  show_id: string;
  cancellation_reason: string | null;
  airtable_record_id: string | null;
  custom: Record<string, unknown> | null;
  show: {
    id: string;
    program: string | null;
    sub_program: string | null;
    main_cast_slots: number | null;
    understudy_slots: number | null;
  } | null;
  city: { id: string; name: string } | null;
}

export function ShowDateDetailSheet({ showDateId, open, onOpenChange }: Props) {
  const { hasRole, user, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const queryClient = useQueryClient();
  const canManage = hasRole('admin') || hasRole('producer');
  // Capability-gated mutating controls, layered on top of the broad canManage
  // read/visibility gate above (which stays unchanged) -- see useCan's
  // "read-only floor" contract in src/hooks/useCapabilities.ts.
  const canManageShowDates = useCan('manage_show_dates');
  const canHardDelete = useCan('hard_delete_show_dates');
  const canRunOfferEngine = useCan('run_offer_engine');
  const canConfirmBookings = useCan('confirm_bookings');

  const { data: showDate, isLoading } = useQuery({
    queryKey: ['show-date-detail', showDateId],
    enabled: !!showDateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select(`
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, cancellation_reason, airtable_record_id, custom,
          show:shows(id, program, sub_program, main_cast_slots, understudy_slots),
          city:cities(id, name)
        `)
        .eq('id', showDateId!)
        .single();
      if (error) throw error;
      return data as unknown as ShowDateDetailRow;
    },
  });

  const showId = showDate?.show_id ?? null;
  const cityId = showDate?.city_id ?? null;
  const slotConfig = showSlots(showDate?.show);

  const { data: bookingsForDate, isError: bookingsError } = useQuery({
    queryKey: ['bookings', 'for-date', showDateId],
    enabled: !!showDateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, artist:artists(id, name)')
        .eq('show_date_id', showDateId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingWithArtist[];
    },
  });

  const { data: cities } = useAllCities(canManage);

  const { data: casts } = useQuery({
    queryKey: ['casts', currentOrg?.id],
    enabled: canManage && !!currentOrg,
    queryFn: () => fetchCasts(supabase, currentOrg?.id ?? null),
  });

  const { data: dateCastOverrides } = useQuery({
    queryKey: ['show-date-cast-eligibility', showDateId],
    enabled: !!showDateId && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_date_cast_eligibility')
        .select('id, cast_id')
        .eq('show_date_id', showDateId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const eligibilityQ = useEligibleArtists(showId, showDateId, cityId);
  const eligibility = eligibilityQ.data;

  const orgId = currentOrg?.id ?? null;

  // Hire-order top CTA: a header shortcut mirroring the HireOrdersCard banner
  // below. Shown when the module is on, the date is fully filled, and no active
  // order covers it yet; drafts the single-date order for the confirmed cast.
  const hireOrdersOn = useFeature('hire_orders');
  const canGenerateHireOrders = useCan('generate_hire_orders');
  const hireOrderAction = useHireOrderAction();
  const { data: dateOrders } = useHireOrdersForDate(hireOrdersOn ? showDateId : null);
  const dateHasActiveOrder = (dateOrders ?? []).some((o) => o.status !== 'void');
  const showGenerateHireOrderCta = hireOrdersOn && canManage &&
    showDate?.status === 'fully_filled' && !dateHasActiveOrder;
  const generateHireOrder = () => {
    if (!orgId || !showDateId) return;
    hireOrderAction.mutate({ action: 'draft', org_id: orgId, show_date_id: showDateId, notify: false });
  };

  const { data: flowData } = useBookingFlow();
  const flow = flowData ?? BOOKING_FLOW_DEFAULTS;
  const { reference, customFieldKey } = useReferenceField();

  // Digest hours + response window feed the "Up next" strip copy. One query,
  // three resolveOrgSetting calls with the canonical fallbacks.
  const { data: times } = useQuery({
    queryKey: ['app-settings', 'booking-times', orgId],
    enabled: Boolean(showDateId && orgId),
    queryFn: async (): Promise<FlowTimes> => {
      const [windowHours, offerDigestHour, confirmationDigestHour] = await Promise.all([
        resolveOrgSetting(supabase, orgId, 'offer_response_window_hours', BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
        resolveOrgSetting(supabase, orgId, 'offer_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
        resolveOrgSetting(supabase, orgId, 'confirmation_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
      ]);
      return { windowHours, offerDigestHour, confirmationDigestHour };
    },
  });
  const effectiveTimes: FlowTimes = times ?? {
    windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
    offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
    confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
  };

  // Direct-booking mode books from the eligibility list, so it needs every active
  // artist's name. Only fetched when the org's flow disables artist acceptance.
  const { data: orgArtists, isError: orgArtistsError } = useQuery({
    queryKey: ['artists', 'for-eligibility', orgId],
    enabled: canManage && !flow.artist_acceptance && !!showDateId && !!orgId,
    queryFn: () => fetchActiveArtistOptions(supabase, orgId ?? null),
  });

  // Blocked artists for this date: the direct-book list must exclude them, the
  // same way open-offer-tier skips blocked_dates server-side for tiered offers.
  const blockedQ = useQuery({
    queryKey: ['blocked-dates', 'for-date', showDate?.date ?? null],
    enabled: canManage && !flow.artist_acceptance && !!showDate?.date,
    queryFn: () => fetchBlockedArtistIds(supabase, { date: showDate!.date, orgId: orgId ?? null }),
  });

  const { data: orgSkills } = useSkills();
  const requiredSkillsQ = useQuery({
    queryKey: ['eligibility', 'required-skills', showDate?.show_id, showDateId],
    enabled: !!showDate?.show_id && !!showDateId,
    queryFn: () => fetchRequiredSkillIds(supabase, { showId: showDate!.show_id, showDateId: showDateId! }),
  });

  // Ad-hoc skill chips the producer picks on the direct-book list, union'd with the
  // date's hard skill requirements into a single set to resolve eligibility against.
  const [directSkillFilterIds, setDirectSkillFilterIds] = useState<string[]>([]);
  const directRequiredSkillIds = useMemo(
    () => unionSkillIds(requiredSkillsQ.data?.all ?? [], directSkillFilterIds),
    [requiredSkillsQ.data?.all, directSkillFilterIds],
  );
  const skillEligibleQ = useQuery({
    queryKey: ['eligibility', 'skill-eligible', showDateId, directRequiredSkillIds],
    enabled: !!showDateId && requiredSkillsQ.data !== undefined,
    queryFn: () => fetchSkillEligibleArtistIds(supabase, { requiredSkillIds: directRequiredSkillIds }),
  });

  const tiersQ = useQuery({
    queryKey: ['offer-tiers', 'available', showDateId, cityId],
    enabled: canManage && !!showDateId,
    // `source` (show vs org ladder) feeds TierTimeline's "Using show-specific
    // priorities" hint below.
    queryFn: () => fetchOfferTiers(supabase, { showId: showId!, cityId, showDateId: showDateId! }),
  });
  const openedQ = useQuery({
    queryKey: ['offer-tiers', 'opened', showDateId],
    enabled: canManage && !!showDateId,
    queryFn: () => fetchOpenedTiers(supabase, showDateId!),
  });

  const [dryRun, setDryRun] = useState<{ tier: number; skillFilterIds: string[] } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelDate = useCancelShowDate();
  const deleteDate = useDeleteShowDate();
  const bookingCount = (bookingsForDate ?? []).filter((b: { status: string }) => b.status !== 'cancelled').length;
  const synced = showDate ? isSyncedDate(showDate) : false;
  const deletable = canHardDelete && showDate ? canHardDeleteDate({ synced, bookingCount }) : false;

  const hasSession = !!(showDate?.session_1 || showDate?.session_2 || showDate?.session_3);

  // Preview-who-gets-offers query, enabled only while the dialog is open.
  const dryRunQ = useQuery({
    queryKey: ['offer-tiers', 'dry-run', showDateId, dryRun?.tier, dryRun?.skillFilterIds],
    enabled: Boolean(dryRun) && !!showDateId,
    queryFn: () => dryRunOfferTier(supabase, {
      showDateId: showDateId!, tier: dryRun!.tier, skillFilterIds: dryRun!.skillFilterIds,
    }),
  });

  // The main/understudy split now lives in AssignedArtistsCard, which derives it
  // from the same helper on the bookings it is handed.
  const { bookedArtistIds } = useMemo(
    () => deriveBookingGroups(bookingsForDate ?? []),
    [bookingsForDate],
  );

  // Eligible artists (with names) for direct-booking mode. deriveDirectBookList
  // fails closed while eligibility/blocked/skill data is unresolved and excludes
  // blocked artists; a null eligibility or skill set means "no restriction".
  const eligibleArtistList = useMemo(
    () => deriveDirectBookList(orgArtists, eligibility, blockedQ.data, skillEligibleQ.data),
    [orgArtists, eligibility, blockedQ.data, skillEligibleQ.data],
  );
  // bookingsForDate is included so the Booked badges are accurate before any
  // Book button renders (an empty booked set would briefly offer Book on an
  // already-booked artist; the DB unique index backstops it, but confusingly).
  const directListError =
    orgArtistsError || eligibilityQ.isError || blockedQ.isError || bookingsError ||
    requiredSkillsQ.isError || skillEligibleQ.isError;
  const directListLoading =
    !directListError &&
    (orgArtists === undefined || eligibility === undefined || blockedQ.data === undefined ||
      bookingsForDate === undefined || skillEligibleQ.data === undefined);

  const overrideCastIds = useMemo(
    () => new Set((dateCastOverrides ?? []).map(r => r.cast_id)),
    [dateCastOverrides]
  );
  const inheritedCastIds = useMemo(
    () => computeInheritedCastIds(eligibility?.castIds, overrideCastIds),
    [eligibility, overrideCastIds]
  );

  const updateDateCity = useMutation({
    mutationFn: async (newCityId: string | null) => {
      const { error } = await supabase
        .from('show_dates')
        .update({ city_id: newCityId })
        .eq('id', showDateId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show-date-detail', showDateId] });
      queryClient.invalidateQueries({ queryKey: ['show-dates'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-artists'] });
      queryClient.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
      toast.success('City updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleDateCast = useMutation({
    mutationFn: async ({ castId, on }: { castId: string; on: boolean }) => {
      if (!currentOrg) throw new Error('No active organization');
      if (on) {
        const { error } = await supabase
          .from('show_date_cast_eligibility')
          .insert({ show_date_id: showDateId!, cast_id: castId, org_id: currentOrg.id });
        if (error) throw error;
      } else {
        const row = dateCastOverrides?.find(r => r.cast_id === castId);
        if (!row) throw new Error('Cast override not found — try refreshing');
        const { error } = await supabase
          .from('show_date_cast_eligibility')
          .delete()
          .eq('id', row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show-date-cast-eligibility', showDateId] });
      queryClient.invalidateQueries({ queryKey: ['eligible-artists'] });
      queryClient.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
      toast.success('Cast eligibility updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const invalidateEligibility = () => {
    queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    queryClient.invalidateQueries({ queryKey: ['eligible-artists'] });
    queryClient.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
    queryClient.invalidateQueries({ queryKey: ['offer-tiers'] });
  };
  const addDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      addShowDateRequiredSkill(supabase, { showDateId: showDateId!, skillId, orgId: currentOrg!.id }),
    onSuccess: () => { invalidateEligibility(); toast.success('Required skill added'); },
    onError: (e: Error) => toast.error('Failed to add required skill', { description: e.message }),
  });
  const removeDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      removeShowDateRequiredSkill(supabase, { showDateId: showDateId!, skillId }),
    onSuccess: () => { invalidateEligibility(); toast.success('Required skill removed'); },
    onError: (e: Error) => toast.error('Failed to remove required skill', { description: e.message }),
  });

  const createBookingMutation = useMutation({
    mutationFn: ({ artistId, isUnderstudy }: { artistId: string; isUnderstudy: boolean }) => {
      if (!currentOrg) throw new Error('No active organization');
      return createBooking(supabase, {
        showDateId: showDateId!,
        artistId,
        isUnderstudy,
        bookedBy: user!.id,
        orgId: currentOrg.id,
        confirmDirectly: !flow.artist_acceptance,
        now: new Date(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Artist booked');
    },
    onError: (err: Error) => {
      // A booking attempt can fail after the row already changed underneath it (e.g. a lost
      // race with another producer), leaving the cached bookings stale even on failure.
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.error(err.message);
    },
  });

  const updateBookingStatus = useMutation({
    mutationFn: ({ bookingId, status }: { bookingId: string; status: 'confirmed' | 'cancelled' }) =>
      updateBookingStatusGuarded(supabase, { bookingId, status, now: new Date() }),
    onSuccess: ({ affected }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast.error('This booking could not be updated. Refresh and retry.');
      } else {
        toast.success('Booking updated');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openOffers = useMutation({
    mutationFn: ({ tier, skillFilterIds }: { tier: number; skillFilterIds: string[] }) =>
      openOfferTier(supabase, { showDateId: showDateId!, tier, skillFilterIds }),
    onSuccess: (res, { tier }) => {
      const { kind, text } = offerResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      if (res.trackingWarning) {
        toast.error('Tier tracking failed to record — re-open the tier to restore escalation and at-risk alerts.');
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const closeOffers = useMutation({
    mutationFn: ({ tier, withdraw }: { tier: number; withdraw: boolean }) =>
      closeOfferTier(supabase, { showDateId: showDateId!, tier, withdraw }),
    onSuccess: (res, { tier }) => {
      const { kind, text } = closeResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const venue = showDate?.venue;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3">
          <div className="flex items-start justify-between gap-3">
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-base">
                {showDate
                  ? referenceLabel({
                      reference,
                      show: showDate.show,
                      custom: (showDate.custom as Record<string, unknown> | null) ?? null,
                      customFieldKey,
                    })
                  : 'Show Date'}
              </SheetTitle>
              {isEditorMode && isRealAdmin && (
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
                  ShowDateDetailSheet.tsx
                </Badge>
              )}
            </SheetHeader>
            {showGenerateHireOrderCta && (
              <Button
                size="sm"
                className="shrink-0"
                onClick={generateHireOrder}
                disabled={hireOrderAction.isPending || !canGenerateHireOrders}
                title={canGenerateHireOrders ? undefined : "You don't have permission to generate hire orders"}
              >
                Generate hire order
              </Button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-32" />
            </div>
          )}

          {showDate && (
            <>
              {/* Date info */}
              <div className="space-y-2">
                <p className="font-display text-[26px] font-semibold tracking-tight">
                  {format(parseDateOnly(showDate.date), 'EEEE, d MMMM yyyy')}
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  {(showDate.session_1 || showDate.session_2 || showDate.session_3) && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {[showDate.session_1, showDate.session_2, showDate.session_3]
                        .filter(Boolean)
                        .map((t: string) => t.slice(0, 5))
                        .join(' / ')}
                    </span>
                  )}
                  {venue && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />{venue}
                    </span>
                  )}
                  {showDate.city?.name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />{showDate.city.name}
                    </span>
                  )}
                </div>
                {showDate.notes && (
                  <p className="text-sm text-muted-foreground italic">{showDate.notes}</p>
                )}
              </div>

              {showDate.status === 'cancelled' && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                  <p className="text-sm font-medium text-destructive">Cancelled</p>
                  {showDate.cancellation_reason && (
                    <p className="text-sm text-destructive/90 mt-0.5">{showDate.cancellation_reason}</p>
                  )}
                </div>
              )}

              {/* Booking funnel + up-next strip */}
              <div className="space-y-3">
                <BookingFunnel bookings={bookingsForDate ?? []} slots={slotConfig} />
                <UpNextStrip
                  items={computeUpNext({
                    flow,
                    times: effectiveTimes,
                    pendingCount: (bookingsForDate ?? []).filter((b) => b.status === 'suggested').length,
                    nextExpiry: (bookingsForDate ?? [])
                      .filter((b) => b.status === 'suggested' && b.offer_expires_at)
                      .map((b) => b.offer_expires_at as string)
                      .sort()[0] ?? null,
                    hasOpenTier: (openedQ.data ?? []).some((t) => !t.closedAt),
                  })}
                />
                {!slotConfig && (
                  <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                    Slot config missing for {showDate.show?.program ?? 'this show'}. Set cast slots in Settings.
                  </Badge>
                )}
              </div>

              {/* Date configuration (producer/admin only) */}
              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base">Date configuration</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">City</label>
                        <Select
                          value={showDate.city_id ?? 'none'}
                          onValueChange={v => updateDateCity.mutate(v === 'none' ? null : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select city" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— None —</SelectItem>
                            {(cities ?? []).map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Extra eligible casts (this date)
                        </label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-between">
                              <span className="truncate">
                                {overrideCastIds.size === 0
                                  ? 'Add cast for this date…'
                                  : `${overrideCastIds.size} added`}
                              </span>
                              <ChevronsUpDown className="h-4 w-4 ml-2 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-1" align="end">
                            <div className="max-h-64 overflow-y-auto">
                              {(casts ?? []).length === 0 && (
                                <p className="text-xs text-muted-foreground p-2">No casts yet.</p>
                              )}
                              {(casts ?? []).map(c => {
                                const on = overrideCastIds.has(c.id);
                                return (
                                  <button
                                    key={c.id}
                                    onClick={() => toggleDateCast.mutate({ castId: c.id, on: !on })}
                                    className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left"
                                  >
                                    <Check className={cn('h-4 w-4 mr-2', on ? 'opacity-100' : 'opacity-0')} />
                                    {c.name}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {(inheritedCastIds.size > 0 || overrideCastIds.size > 0) && (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(inheritedCastIds).map(cid => (
                            <Badge key={cid} variant="outline" className="text-xs">
                              {casts?.find(c => c.id === cid)?.name}
                              <span className="ml-1 opacity-60">
                                inherited{showDate.city?.name ? ` via ${showDate.city.name}` : ''}
                              </span>
                            </Badge>
                          ))}
                          {Array.from(overrideCastIds).map(cid => (
                            <Badge key={cid} variant="secondary" className="text-xs">
                              {casts?.find(c => c.id === cid)?.name}
                            </Badge>
                          ))}
                        </div>
                        {inheritedCastIds.size > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Inherited casts come from the city eligibility matrix in Settings → Cities &amp; Casts. Update the city above or adjust cast eligibility there.
                          </p>
                        )}
                      </div>
                    )}

                    <RequiredSkillsSection
                      skills={orgSkills ?? []}
                      showSkillIds={requiredSkillsQ.data?.showSkillIds ?? []}
                      dateSkillIds={requiredSkillsQ.data?.dateSkillIds ?? []}
                      onAdd={(id) => addDateSkill.mutate(id)}
                      onRemove={(id) => removeDateSkill.mutate(id)}
                      pending={addDateSkill.isPending || removeDateSkill.isPending}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Date actions (edit / cancel / delete) */}
              {canManage && showDate.status !== 'cancelled' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!canManageShowDates}
                    title={canManageShowDates ? undefined : "You don't have permission to edit show dates"}>
                    {synced ? 'Edit notes' : 'Edit schedule'}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">Cancel date</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this date?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This releases all bookings for this date and notifies booked artists. Add a reason:
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (e.g. venue lost)" />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep date</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelDate.mutate({ id: showDate.id, reason: cancelReason },
                            { onSuccess: () => { toast.success('Date cancelled'); onOpenChange(false); },
                              onError: (e) => toast.error((e as Error).message) })}>
                          Cancel date
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {canHardDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={!deletable}
                          title={deletable ? 'Delete date' : synced ? "Synced dates can't be deleted — cancel instead" : 'Has bookings — cancel instead'}>
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this date?</AlertDialogTitle>
                          <AlertDialogDescription>This permanently removes the date. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteDate.mutate(showDate.id,
                            { onSuccess: () => { toast.success('Date deleted'); onOpenChange(false); },
                              onError: (e) => toast.error((e as Error).message) })}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}

              {/* The booking region: offers / direct booking (producers, live dates
                  only) plus the assigned-artists card, behind one module gate. */}
              <BookingCardSection
                bookings={bookingsForDate ?? []}
                canManage={canManage}
                showConfirm={canConfirmBookings}
                onConfirm={(bookingId) => updateBookingStatus.mutate({ bookingId, status: 'confirmed' })}
                onCancel={(bookingId) => updateBookingStatus.mutate({ bookingId, status: 'cancelled' })}
              >
                {canManage && showDate.status !== 'cancelled' && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display text-base">
                        {flow.artist_acceptance ? 'Offers' : 'Book artists'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {flow.artist_acceptance ? (
                        <>
                          <TierTimeline
                            showDateId={showDate.id}
                            cityId={cityId}
                            dateLabel={formatDateDMY(showDate.date)}
                            flow={flow}
                            bookings={bookingsForDate ?? []}
                            canManage={canRunOfferEngine}
                            hasSession={hasSession}
                            tiers={tiersQ.data ?? { priorities: [], hasAdHoc: false }}
                            ladderSource={tiersQ.data?.source ?? "org"}
                            skills={orgSkills ?? []}
                            openedTiers={openedQ.data ?? []}
                            isLoadingTiers={tiersQ.isLoading}
                            isLoadingOpened={openedQ.isLoading}
                            openPending={openOffers.isPending}
                            closePending={closeOffers.isPending}
                            onOpenTier={(tier, skillFilterIds) => openOffers.mutate({ tier, skillFilterIds })}
                            onCloseTier={(tier, withdraw) => closeOffers.mutate({ tier, withdraw })}
                            onPreviewTier={(tier, skillFilterIds) => setDryRun({ tier, skillFilterIds })}
                          />
                          <DryRunDialog
                            open={Boolean(dryRun)}
                            onOpenChange={(o) => { if (!o) setDryRun(null); }}
                            tier={dryRun?.tier ?? null}
                            result={dryRunQ.data ?? null}
                            loading={dryRunQ.isLoading}
                            flow={flow}
                            confirmPending={openOffers.isPending}
                            onConfirm={() => {
                              if (dryRun) openOffers.mutate({ tier: dryRun.tier, skillFilterIds: dryRun.skillFilterIds });
                              setDryRun(null);
                            }}
                          />
                        </>
                      ) : (
                        <EligibilityBookList
                          artists={eligibleArtistList}
                          loading={directListLoading}
                          error={directListError}
                          bookedArtistIds={bookedArtistIds}
                          onBook={(artistId, isUnderstudy) =>
                            createBookingMutation.mutate({ artistId, isUnderstudy })}
                          booking={createBookingMutation.isPending}
                          skills={orgSkills ?? []}
                          selectedSkillIds={directSkillFilterIds}
                          onSkillFilterChange={(id) =>
                            setDirectSkillFilterIds((prev) =>
                              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                        />
                      )}
                    </CardContent>
                  </Card>
                )}
              </BookingCardSection>

              {/* Hire orders (feature-gated; producer/admin management surface) */}
              <HireOrdersCard
                showDateId={showDate.id}
                showDate={showDate}
                bookings={bookingsForDate ?? []}
                canManage={canManage}
              />

              {/* Chat */}
              <ChatPanel showDateId={showDate.id} showDate={showDate.date} />

              <ShowDateFormDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                mode="edit"
                showDate={{
                  id: showDate.id, show_id: showDate.show_id, date: showDate.date,
                  session_1: showDate.session_1, session_2: showDate.session_2, session_3: showDate.session_3,
                  venue: showDate.venue, city_id: showDate.city_id, notes: showDate.notes,
                  airtable_record_id: showDate.airtable_record_id, status: showDate.status,
                }}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
