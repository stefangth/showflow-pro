import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
import { IconTooltip } from '@/components/common/IconTooltip';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEligibleArtists } from '@/hooks/useEligibleArtists';
import { useSkills } from '@/hooks/useSkills';
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow';
import { showSlots } from '@/lib/settings';
import {
  deriveBookingGroups, computeInheritedCastIds,
  offerResultToast, closeResultToast, deriveDirectBookList,
} from '@/lib/bookings';
import { computeUpNext, computeFunnel, computeHeaderCta, buildActivity, computeHireFooter, tierFillCounts } from '@/lib/bookingCockpit';
import { resolveNextOfferTarget } from '@/lib/offerTarget';
import { useShowSlots } from '@/hooks/useShowSlots';
import { useTierCastMap, useTierLadderCounts } from '@/hooks/useTierLadder';
import { BOOKING_FLOW_DEFAULTS, referenceLabel, type FlowTimes } from '@/lib/bookingFlow';
import { ROUTES, BOOKING_ENGINE_DEFAULTS } from '@/config/app.config';
import { formatDateDMY, parseDateOnly } from '@/lib/dates';
import {
  openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier,
  dryRunOfferTier, createBooking, updateBookingStatusGuarded, bulkConfirmSoftBooked,
} from '@/data/bookings';
import {
  fetchRequiredSkillIds, fetchSkillEligibleArtistIds, addShowDateRequiredSkill, removeShowDateRequiredSkill,
  fetchShowDateSkillDrops, addShowDateSkillDrop, removeShowDateSkillDrop,
} from '@/data/eligibility';
import { unionSkillIds } from '@/lib/eligibility';
import { resolveOrgSetting } from '@/data/settings';
import { TierTimeline } from '@/components/shows/date/TierTimeline';
import { DryRunDialog } from '@/components/shows/date/DryRunDialog';
import { EligibilityBookList } from '@/components/shows/date/EligibilityBookList';
import { RequiredSkillsSection } from '@/components/shows/date/RequiredSkillsSection';
import { CockpitHeader, type CockpitTab } from '@/components/shows/date/CockpitHeader';
import { CockpitRail } from '@/components/shows/date/CockpitRail';
import { CockpitShell } from '@/components/shows/date/CockpitShell';
import { CockpitPager } from '@/components/shows/date/CockpitPager';
import { CockpitFooter } from '@/components/shows/date/CockpitFooter';
import { CockpitCastList } from '@/components/shows/date/CockpitCastList';
import { buildCastGroups } from '@/lib/cockpitCast';
import { fetchBlockedArtistIds } from '@/data/blockedDates';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { HireOrdersCard } from '@/components/shows/hireOrders/HireOrdersCard';
import { useHireOrdersForDate, useHireOrderAction } from '@/hooks/useHireOrders';
import { useEntitlements, useFeature, useModuleGate } from '@/hooks/useEntitlements';
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
  /** Optional prev/next pager, supplied only from a list context (the bookings
   *  page) so the cockpit can walk the current filtered/sorted list. Omitted by
   *  the artist and chat call sites, which have no such list. */
  pager?: {
    index: number; // 1-based position in the list
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}

type BookingWithArtist = Booking & { artist: Pick<Artist, 'id' | 'name'> };

/** The assigned-artists card: the sheet's single cast surface. `canManage=false`
 *  renders every row without its Confirm/Cancel controls, which is exactly the
 *  shape the read-only (module-off / artist) view needs. */
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

export function ShowDateDetailSheet({ showDateId, open, onOpenChange, pager }: Props) {
  const { hasRole, user, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = hasRole('admin') || hasRole('producer');
  // Capability-gated mutating controls, layered on top of the broad canManage
  // read/visibility gate above (which stays unchanged) -- see useCan's
  // "read-only floor" contract in src/hooks/useCapabilities.ts.
  const canManageShowDates = useCan('manage_show_dates');
  const canHardDelete = useCan('hard_delete_show_dates');
  const canRunOfferEngine = useCan('run_offer_engine');
  const canConfirmBookings = useCan('confirm_bookings');
  const canEditBookingSettings = useCan('edit_booking_settings');
  // Slot meter + status line + activity feed are pure booking-engine status, so
  // they follow the same module gate as the offers surface (super-admin exempt,
  // fails closed while entitlements load) rather than useFeature.
  const { allow: bookingModuleAllowed } = useModuleGate('booking_flow');
  // The org's actual booking_flow entitlement, no super-admin bypass and no loading fail-open
  // — feeds the cast list's cancel-confirmation who-hears line (cancelBookingCopy ->
  // scheduleChangeNote), which makes a factual claim about what the schedule-change pipeline
  // will do for THIS org, not a permission check. `useFeature` was the wrong hook here: it
  // returns the feature's REGISTRY DEFAULT (true for booking_flow) while entitlements are
  // still loading, and CockpitCastList can mount before that resolves for a non-impersonating
  // super-admin (useModuleGate exempts super-admins unconditionally, even mid-load) — so a
  // super-admin viewing an org WITHOUT the module could briefly see the digest-email sentence
  // instead of the honest fallback. Reading useEntitlements() directly and gating on
  // `!isLoading` has neither failure mode, exactly like ShowDateFormDialog.tsx's own
  // `changeNote` already does for the identical problem ("a plausible but wrong claim is worse
  // than a brief silence").
  const { features: bookingEntitledFeatures, isLoading: bookingEntitlementsLoading } = useEntitlements();
  const bookingFlowFeatureEnabled = !bookingEntitlementsLoading && bookingEntitledFeatures.has('booking_flow');

  const [activeTab, setActiveTab] = useState<CockpitTab>('cast');
  // The sheet instance is reused across dates (no key at the mount sites), so reset
  // to the default tab whenever it opens for a different date — otherwise a stale
  // tab (e.g. Setup) carries over. Render-time reset avoids an effect-driven flash.
  const [tabResetFor, setTabResetFor] = useState(showDateId);
  if (showDateId !== tabResetFor) {
    setTabResetFor(showDateId);
    setActiveTab('cast');
  }

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
  // showSlots returns a fresh object literal each call; memoize so slotConfig has
  // a stable identity across renders where the show is unchanged — otherwise it
  // would defeat the castGroups useMemo that depends on it.
  const slotConfig = useMemo(() => showSlots(showDate?.show), [showDate?.show]);

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
  // in the Hire order tab. Shown when the module is on, the date is fully filled,
  // and no active order covers it yet; drafts the single-date order for the
  // confirmed cast.
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
  // Show-level skills dropped on this date (a drop only bites when the skill is a
  // show requirement; the raw list is filtered against showSkillIds at render).
  const dropsQ = useQuery({
    queryKey: ['eligibility', 'date-skill-drops', showDateId],
    enabled: !!showDateId,
    queryFn: () => fetchShowDateSkillDrops(supabase, showDateId!),
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

  // Offers-tab cockpit data (design 1e). Gated to the tiered offers path so the
  // direct-book / artist / module-off surfaces never fetch it. Each hook's own
  // `enabled` also stays disabled until its ids resolve.
  const tieredOffersActive = canManage && flow.artist_acceptance;
  const { data: showSlotsData } = useShowSlots(tieredOffersActive ? showId : null);
  const { data: tierMapData } = useTierCastMap(
    tieredOffersActive ? showId : null,
    tieredOffersActive ? cityId : null,
  );
  const { data: ladderRowsData } = useTierLadderCounts(
    tieredOffersActive ? showId : null,
    tieredOffersActive ? showDateId : null,
    tieredOffersActive ? cityId : null,
    orgId,
  );
  const tierMap = tierMapData ?? [];
  const ladderRows = ladderRowsData ?? [];

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
  const dropDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      addShowDateSkillDrop(supabase, { showDateId: showDateId!, skillId, orgId: currentOrg!.id }),
    onSuccess: () => { invalidateEligibility(); toast.success('Skill dropped on this date'); },
    onError: (e: Error) => toast.error('Failed to drop skill', { description: e.message }),
  });
  const restoreDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      removeShowDateSkillDrop(supabase, { showDateId: showDateId!, skillId }),
    onSuccess: () => { invalidateEligibility(); toast.success('Skill restored on this date'); },
    onError: (e: Error) => toast.error('Failed to restore skill', { description: e.message }),
  });
  // RequiredSkillsCard "Reset to computed": drop every date-add and restore every
  // drop in one pass, then invalidate once (rather than one toast per skill).
  const resetDateSkills = useMutation({
    mutationFn: async () => {
      const dateAdds = requiredSkillsQ.data?.dateSkillIds ?? [];
      const drops = dropsQ.data ?? [];
      await Promise.all([
        ...dateAdds.map((id) => removeShowDateRequiredSkill(supabase, { showDateId: showDateId!, skillId: id })),
        ...drops.map((id) => removeShowDateSkillDrop(supabase, { showDateId: showDateId!, skillId: id })),
      ]);
    },
    onSuccess: () => { invalidateEligibility(); toast.success('Reset to computed skills'); },
    onError: (e: Error) => toast.error('Failed to reset skills', { description: e.message }),
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
    onSuccess: ({ affected }, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast.error('This booking could not be updated. Refresh and retry.');
      } else if (variables.status === 'confirmed') {
        // Names the artist so the toast reads as a receipt ("Booked Ada Lovelace.") rather
        // than a generic status ack — bookingsForDate (not the memoized `bookings`, which is
        // declared further down) already carries the artist join this lookup needs.
        const name = (bookingsForDate ?? []).find((b) => b.id === variables.bookingId)?.artist?.name;
        toast.success(name ? `Booked ${name}.` : 'Booking updated');
      } else {
        toast.success('Booking updated');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Header "Confirm N accepted": one guarded bulk update, not N per-row PATCHes.
  const confirmAccepted = useMutation({
    mutationFn: (ids: string[]) => bulkConfirmSoftBooked(supabase, { ids, now: new Date() }),
    onSuccess: ({ affected }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(affected ? `Confirmed ${affected}` : 'Nothing to confirm, it moved on');
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

  // ── Derived cockpit values ──────────────────────────────────────────────
  // Stable reference (react-query data or a constant empty array) so memoized
  // consumers like castGroups don't bust on every render.
  const bookings = useMemo(() => bookingsForDate ?? [], [bookingsForDate]);
  const funnel = computeFunnel(bookings);
  const confirmedCount = funnel.confirmedMain + funnel.confirmedUnderstudy;
  const acceptedCount = bookings.filter((b) => b.status === 'soft_booked').length;
  const totalSlots = slotConfig ? slotConfig.main_cast + slotConfig.understudies : null;
  const highestOpenTier = (openedQ.data ?? [])
    .filter((t) => !t.closedAt)
    .reduce<number | null>((m, t) => Math.max(m ?? 0, t.tier), null);
  // Highest tier ever opened (open or since-closed) — the basis for "open next
  // tier", so the escalation CTA survives closing a tier without filling it.
  const highestOpenedTier = (openedQ.data ?? [])
    .reduce<number | null>((m, t) => Math.max(m ?? 0, t.tier), null);

  // Single source of truth for "the next tier to offer to": the header CTA, the
  // Offers-tab hero, and the ladder ring all read this. `(openTier ?? 0) + 1`
  // clamped to the ladder — null when that tier isn't a ladder row (all opened).
  const nextTierRaw = (highestOpenedTier ?? 0) + 1;
  const nextTier = ladderRows.some((r) => r.tier === nextTierRaw) ? nextTierRaw : null;
  const nextTierTarget = nextTier != null ? resolveNextOfferTarget(tierMap, nextTier) : null;
  const nextTierCounts = nextTier != null ? (ladderRows.find((r) => r.tier === nextTier) ?? null) : null;

  // Primary booking-workflow action for the header (hire-order terminal is the
  // separate showGenerateHireOrderCta button below).
  const workflowCta = computeHeaderCta({
    artistAcceptance: flow.artist_acceptance,
    acceptedCount, confirmedCount, totalSlots,
    openTier: highestOpenedTier,
    currentTierOpen: highestOpenTier != null,
    maxTier: tiersQ.data?.priorities.length ?? 3,
    // RELABEL the CTA to the cast when the next tier resolves to a single one.
    nextTierCastName: nextTierTarget?.kind === 'cast' ? nextTierTarget.cast.name : null,
  });
  const ctaAllowed =
    workflowCta.kind === 'confirm' ? canConfirmBookings :
    workflowCta.kind === 'openTier' ? canRunOfferEngine :
    workflowCta.kind === 'book' ? canManage :
    workflowCta.kind === 'reviewOffers' ? canManage : false;
  const onWorkflowCta = () => {
    switch (workflowCta.kind) {
      case 'confirm': {
        const ids = bookings.filter((b) => b.status === 'soft_booked').map((b) => b.id);
        if (ids.length) confirmAccepted.mutate(ids);
        break;
      }
      case 'openTier':
        // Preview the next tier on the Offers tab (like TierTimeline) rather than
        // opening it on a single header click — the actual offer-send is confirmed
        // from the dry-run dialog, never fired directly from here.
        setActiveTab('offers');
        setDryRun({ tier: (highestOpenedTier ?? 0) + 1, skillFilterIds: [] });
        break;
      case 'book':
      case 'reviewOffers':
        setActiveTab('offers');
        break;
      default:
        break;
    }
  };

  // Header status line: reuse the existing up-next signal, degrade to a fill
  // status. Cancelled short-circuits everything.
  const pendingCount = bookings.filter((b) => b.status === 'suggested').length;
  const nextExpiry = bookings
    .filter((b) => b.status === 'suggested' && b.offer_expires_at)
    .map((b) => b.offer_expires_at as string)
    .sort()[0] ?? null;
  const upNextItems = computeUpNext({
    flow,
    times: effectiveTimes,
    pendingCount,
    nextExpiry,
    hasOpenTier: (openedQ.data ?? []).some((t) => !t.closedAt),
  });
  let statusText = '';
  let statusTone: 'green' | 'amber' | 'accent' | 'muted' = 'muted';
  if (showDate?.status === 'cancelled') {
    statusText = 'Cancelled';
    statusTone = 'muted';
  } else if (totalSlots != null && confirmedCount >= totalSlots) {
    statusText = 'All slots confirmed';
    statusTone = 'green';
  } else if (highestOpenTier != null) {
    // Fold the offers-expiry signal into the open-tier status (matches the
    // reference "Tier N open · N offers expire …"); the lower-priority digest /
    // auto-escalate pills go to the rail's Up next block below.
    const expiryItem = upNextItems.find((i) => i.kind === 'expiry');
    statusText = expiryItem ? `Tier ${highestOpenTier} open · ${expiryItem.text}` : `Tier ${highestOpenTier} open`;
    statusTone = 'amber';
  } else if (upNextItems.length > 0) {
    statusText = upNextItems[0].text;
    statusTone = upNextItems[0].tone === 'amber' ? 'amber'
      : upNextItems[0].tone === 'violet' ? 'accent' : 'muted';
  } else if (acceptedCount > 0) {
    statusText = `${acceptedCount} accepted, waiting on confirm`;
    statusTone = 'amber';
  }

  const activity = buildActivity({ bookings, openedTiers: openedQ.data ?? [] });

  // Per-opened-tier status counts for the tier ladder. One entry per OPENED tier
  // (a missing entry degrades that ladder row), so iterate openedQ, not bookings.
  // `sent` = every offer ever made in the tier; `declined` = the cancelled ones.
  const statusByTier = (openedQ.data ?? []).map((o) => {
    const counts = tierFillCounts(bookings, o.tier);
    const inTier = bookings.filter((b) => b.offer_tier === o.tier);
    return {
      tier: o.tier,
      sent: inTier.length,
      accepted: counts.accepted,
      pending: counts.pending,
      declined: inTier.filter((b) => b.status === 'cancelled').length,
    };
  });

  // The hero's avatar row + the cast-aware confirm's "Not offered" line reuse the
  // dry-run already in scope, but only when it's the preview for the NEXT tier.
  const nextTierDryRun = dryRun?.tier === nextTier ? dryRunQ.data : undefined;
  const nextTierCandidates = nextTierDryRun?.candidates ?? [];
  const nextTierExcludedDetail = nextTierDryRun?.excludedDetail;

  // showDate-dependent presentational values (safe fallbacks when unloaded).
  const title = showDate
    ? referenceLabel({
        reference,
        show: showDate.show,
        custom: (showDate.custom as Record<string, unknown> | null) ?? null,
        customFieldKey,
      })
    : 'Show Date';
  const dateLine = showDate ? format(parseDateOnly(showDate.date), 'EEEE, d MMMM yyyy') : '';
  const sessionTimes = showDate
    ? [showDate.session_1, showDate.session_2, showDate.session_3]
        .filter(Boolean)
        .map((t) => (t as string).slice(0, 5))
        .join(' / ')
    : '';
  const metaLine = showDate
    ? [sessionTimes, showDate.venue, showDate.city?.name].filter(Boolean).join(' · ')
    : '';
  const railSource: 'airtable' | 'manual' = showDate?.airtable_record_id ? 'airtable' : 'manual';
  const castChips = [
    ...Array.from(inheritedCastIds).map((cid) => ({
      label: casts?.find((c) => c.id === cid)?.name ?? 'Cast',
      kind: 'inherited' as const,
    })),
    ...Array.from(overrideCastIds).map((cid) => ({
      label: casts?.find((c) => c.id === cid)?.name ?? 'Cast',
      kind: 'override' as const,
    })),
  ];
  const skillChips = (requiredSkillsQ.data?.all ?? [])
    .map((id) => orgSkills?.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  // Only the Cast tab (module-on path) consumes these groups; skip the remap when
  // the sheet is closed, still loading, or degrading to AssignedArtistsCard, and
  // memoize the mapping like the sibling deriveBookingGroups call. `mutate` is
  // referentially stable (react-query), so the row handlers stay stable too.
  const mutateBookingStatus = updateBookingStatus.mutate;
  const castGroups = useMemo(
    () =>
      open && showDate && bookingModuleAllowed
        ? buildCastGroups(bookings, slotConfig, {
            canConfirm: canManage && canConfirmBookings,
            onConfirm: (bookingId) => mutateBookingStatus({ bookingId, status: 'confirmed' }),
            canCancel: canManage,
            onCancel: (bookingId) => mutateBookingStatus({ bookingId, status: 'cancelled' }),
            // Opening a slot goes to the offers/book tab: gate on the capability that
            // actually drives it (run_offer_engine for classic offers, canManage for
            // direct booking) — not confirm_bookings — and label it per flow.
            canOpenSlot: flow.artist_acceptance ? canRunOfferEngine : canManage,
            slotActionLabel: flow.artist_acceptance ? 'Open next tier' : 'Book artist',
            onOpenSlot: () => setActiveTab('offers'),
          })
        : [],
    [
      open, showDate, bookingModuleAllowed, bookings, slotConfig, canManage,
      canConfirmBookings, canRunOfferEngine, flow.artist_acceptance,
      mutateBookingStatus, setActiveTab,
    ],
  );

  // Persistent hire-order footer state (mirrors the prototype's footer bar).
  // Readiness follows the DB's fully_filled definition (per-role), same as the
  // header CTA — a flat confirmed>=total sum could green-light drafting while a
  // role is still short.
  const hireFooter = computeHireFooter({
    status: showDate?.status ?? null,
    slots: slotConfig,
    confirmedMain: funnel.confirmedMain,
    confirmedUnderstudy: funnel.confirmedUnderstudy,
  });
  const showFooter = open && hireOrdersOn && canManage && !!slotConfig && showDate?.status !== 'cancelled';
  const footer = showFooter
    ? dateHasActiveOrder
      ? {
          badgeLabel: 'DRAFTED', ready: true, detail: 'A hire order already covers this date',
          ctaLabel: 'Open hire order', ctaDisabled: false, onCta: () => setActiveTab('order'),
        }
      : {
          badgeLabel: hireFooter.badgeLabel,
          ready: hireFooter.ready,
          detail: hireFooter.detail,
          ctaLabel: hireFooter.ready ? 'Generate hire order' : 'Generate',
          ctaDisabled: !hireFooter.ready || hireOrderAction.isPending || !canGenerateHireOrders,
          onCta: generateHireOrder,
        }
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1080px] overflow-y-auto p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}

        {showDate && (
          <>
            <CockpitShell
              header={
                <>
                {pager && (
                  <CockpitPager
                    label={`Date ${pager.index} of ${pager.total}`}
                    onPrev={pager.onPrev}
                    onNext={pager.onNext}
                    prevDisabled={pager.index <= 1}
                    nextDisabled={pager.index >= pager.total}
                  />
                )}
                <CockpitHeader
                  title={title}
                  dateLine={dateLine}
                  metaLine={metaLine}
                  slots={slotConfig}
                  slotWarning={!slotConfig ? `Slot config missing for ${showDate.show?.program ?? 'this show'}. Set cast slots in Settings.` : undefined}
                  confirmedCount={confirmedCount}
                  acceptedCount={acceptedCount}
                  statusText={statusText}
                  statusTone={statusTone}
                  showEngineStatus={bookingModuleAllowed}
                  // The header CTA writes on the booking path (Confirm N -> guarded
                  // status update). Gate it on the booking_flow module too, not just
                  // capability, so a module-off org can't confirm a legacy soft_booked
                  // row through the header (the rest of the booking surface is gated).
                  workflowCta={bookingModuleAllowed && ctaAllowed && workflowCta.kind !== 'none' ? workflowCta : null}
                  workflowCtaDisabled={updateBookingStatus.isPending || openOffers.isPending || confirmAccepted.isPending}
                  onWorkflowCta={onWorkflowCta}
                  showGenerateHireOrder={!!showGenerateHireOrderCta}
                  generateDisabled={hireOrderAction.isPending || !canGenerateHireOrders}
                  generateTitle={canGenerateHireOrders ? undefined : "You don't have permission to generate hire orders"}
                  onGenerate={generateHireOrder}
                  flowLabel={flow.artist_acceptance ? 'Classic offers' : 'Direct booking'}
                  onEditFlow={canEditBookingSettings ? () => navigate(ROUTES.SETTINGS) : undefined}
                  tabs={[
                    { id: 'cast', label: 'Cast' },
                    { id: 'offers', label: flow.artist_acceptance ? 'Offers' : 'Book artists', hidden: !canManage },
                    { id: 'order', label: 'Hire order', hidden: !hireOrdersOn },
                    { id: 'chat', label: 'Chat' },
                    { id: 'setup', label: 'Setup', hidden: !canManage },
                  ]}
                  activeTab={activeTab}
                  onTab={setActiveTab}
                  devBadge={isEditorMode && isRealAdmin}
                  overflowActions={canManage ? [
                    { label: 'Edit date setup', onSelect: () => setActiveTab('setup') },
                    // Same capability gate as the Setup-tab Edit control: opening the
                    // schedule/notes dialog requires manage_show_dates, not just the
                    // broad admin|producer read gate.
                    ...(canManageShowDates
                      ? [{ label: synced ? 'Edit notes' : 'Edit schedule', onSelect: () => setEditOpen(true) }]
                      : []),
                  ] : []}
                />
                </>
              }
              banner={
                <>
                  {/* Slot-config-missing now renders inline in the header (in the
                      meter's place); only the cancelled notice remains a banner. */}
                  {showDate.status === 'cancelled' && (
                    <div className="px-6 pt-4">
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                        <p className="text-sm font-medium text-destructive">Cancelled</p>
                        {showDate.cancellation_reason && (
                          <p className="text-sm text-destructive/90 mt-0.5">{showDate.cancellation_reason}</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              }
              rail={
                <CockpitRail
                  times={sessionTimes || null}
                  venue={showDate.venue}
                  city={showDate.city?.name ?? null}
                  source={railSource}
                  notes={showDate.notes}
                  castChips={castChips}
                  skillChips={skillChips}
                  // Expiry is folded into the header status line; the rail keeps
                  // the lower-priority digest-send / auto-escalate signals.
                  upNext={bookingModuleAllowed ? upNextItems.filter((i) => i.kind !== 'expiry') : []}
                  activity={bookingModuleAllowed ? activity : []}
                  chatUnread={0}
                  chatPreview={null}
                  onOpenChat={() => setActiveTab('chat')}
                  showEditSetup={canManage}
                  onEditSetup={() => setActiveTab('setup')}
                />
              }
              footer={footer ? <CockpitFooter {...footer} /> : undefined}
            >
                {activeTab === 'cast' && (
                  bookingModuleAllowed ? (
                    <CockpitCastList
                      groups={castGroups}
                      flow={flow}
                      bookingFlowEnabled={bookingFlowFeatureEnabled}
                      confirmationDigestHour={effectiveTimes.confirmationDigestHour}
                    />
                  ) : (
                    <AssignedArtistsCard
                      bookings={bookings}
                      canManage={false}
                      showConfirm={false}
                      onConfirm={(bookingId) => updateBookingStatus.mutate({ bookingId, status: 'confirmed' })}
                      onCancel={(bookingId) => updateBookingStatus.mutate({ bookingId, status: 'cancelled' })}
                    />
                  )
                )}

                {activeTab === 'offers' && (
                  <ModuleGate feature="booking_flow">
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
                                dateLabel={formatDateDMY(showDate.date)}
                                flow={flow}
                                bookings={bookingsForDate ?? []}
                                canManage={canRunOfferEngine}
                                hasSession={hasSession}
                                ladderSource={tiersQ.data?.source ?? "org"}
                                skills={orgSkills ?? []}
                                openedTiers={openedQ.data ?? []}
                                openPending={openOffers.isPending}
                                closePending={closeOffers.isPending}
                                onOpenTier={(tier, skillFilterIds) => openOffers.mutate({ tier, skillFilterIds })}
                                onCloseTier={(tier, withdraw) => closeOffers.mutate({ tier, withdraw })}
                                onPreviewTier={(tier, skillFilterIds) => setDryRun({ tier, skillFilterIds })}
                                // design 1e cockpit cards
                                show={showDate.show?.program ?? ''}
                                slots={showSlotsData ?? []}
                                showSkillIds={requiredSkillsQ.data?.showSkillIds ?? []}
                                dateSkillIds={requiredSkillsQ.data?.dateSkillIds ?? []}
                                droppedSkillIds={dropsQ.data ?? []}
                                onResetSkills={() => resetDateSkills.mutate()}
                                onEditSkills={() => setActiveTab('setup')}
                                ladderRows={ladderRows}
                                cityName={showDate.city?.name ?? ''}
                                statusByTier={statusByTier}
                                nextTier={nextTier}
                                nextTierTarget={nextTierTarget}
                                nextTierCounts={nextTierCounts}
                                requiredSkillNames={skillChips}
                                requiredSkillIds={requiredSkillsQ.data?.all ?? []}
                                candidates={nextTierCandidates}
                                excludedDetail={nextTierExcludedDetail}
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
                              // deriveDirectBookList treats a null artistIds set as "no
                              // restriction" (src/lib/bookings.ts), the same signal this note
                              // reads to tell the producer the picker is wide open on purpose.
                              unrestricted={eligibility?.artistIds == null}
                              orgName={currentOrg?.name}
                              // 1h requirement-as-fact sentence: skillChips is the same
                              // required-skill NAME list the rail already shows, reused here
                              // rather than recomputed. totalArtistCount is the org's whole
                              // active roster (undefined while orgArtists is still loading,
                              // which keeps the sentence hidden instead of claiming "of 0").
                              requiredSkillNames={skillChips}
                              totalArtistCount={orgArtists?.length}
                              // 1h: the narrowing chips are EXTRA skills only. Exclude the
                              // date's already-required skills so they don't render as no-op
                              // chips whose count equals the whole qualifying list.
                              requiredSkillIds={requiredSkillsQ.data?.all ?? []}
                            />
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </ModuleGate>
                )}

                {activeTab === 'order' && (
                  <HireOrdersCard
                    showDateId={showDate.id}
                    showDate={showDate}
                    bookings={bookings}
                    canManage={canManage}
                  />
                )}

                {activeTab === 'chat' && (
                  <ChatPanel showDateId={showDate.id} showDate={showDate.date} />
                )}

                {activeTab === 'setup' && canManage && (
                  <div className="space-y-6">
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
                          droppedSkillIds={dropsQ.data ?? []}
                          onAdd={(id) => addDateSkill.mutate(id)}
                          onRemove={(id) => removeDateSkill.mutate(id)}
                          onDrop={(id) => dropDateSkill.mutate(id)}
                          onRestore={(id) => restoreDateSkill.mutate(id)}
                          pending={addDateSkill.isPending || removeDateSkill.isPending
                            || dropDateSkill.isPending || restoreDateSkill.isPending}
                        />
                      </CardContent>
                    </Card>

                    {showDate.status !== 'cancelled' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <IconTooltip label={canManageShowDates ? '' : "You don't have permission to edit show dates"}>
                          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!canManageShowDates}>
                            {synced ? 'Edit notes' : 'Edit schedule'}
                          </Button>
                        </IconTooltip>

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
                            <IconTooltip label={deletable ? '' : synced ? "Synced dates can't be deleted — cancel instead" : 'Has bookings — cancel instead'}>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive" disabled={!deletable}>
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                            </IconTooltip>
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
                  </div>
                )}
            </CockpitShell>

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
      </SheetContent>
    </Sheet>
  );
}
