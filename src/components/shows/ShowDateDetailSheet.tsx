import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
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
import { showLabel } from '@/types';
import { useEligibleArtists } from '@/hooks/useEligibleArtists';
import { showSlots } from '@/lib/settings';
import {
  deriveBookingGroups, computeInheritedCastIds,
  buildOfferTierOptions, offerResultToast, offerConfirmCopy,
  pendingOfferCount, closeConfirmCopy, closeResultToast,
} from '@/lib/bookings';
import { formatDateDMY, formatTimestampDMY } from '@/lib/dates';
import { openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier, updateBookingStatusGuarded } from '@/data/bookings';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { useCancelShowDate, useDeleteShowDate } from '@/hooks/useShowDates';
import { isSyncedDate, canHardDeleteDate } from '@/lib/catalog';
import type { Booking, Artist, City, Cast } from '@/types';

interface Props {
  showDateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BookingWithArtist = Booking & { artist: Pick<Artist, 'id' | 'name'> };

const BOOKING_STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-success/10 text-success',
  soft_booked: 'bg-warning/10 text-warning',
  suggested: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
};

export function ShowDateDetailSheet({ showDateId, open, onOpenChange }: Props) {
  const { hasRole, user, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const queryClient = useQueryClient();
  const canManage = hasRole('admin') || hasRole('producer');

  const { data: showDate, isLoading } = useQuery({
    queryKey: ['show-date-detail', showDateId],
    enabled: !!showDateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select(`
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, cancellation_reason, airtable_record_id,
          show:shows(id, program, sub_program, main_cast_slots, understudy_slots),
          city:cities(id, name)
        `)
        .eq('id', showDateId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const showId = showDate?.show_id ?? null;
  const cityId = showDate?.city_id ?? null;
  const slotConfig = showSlots(showDate?.show);

  const { data: bookingsForDate } = useQuery({
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

  const { data: cities } = useQuery({
    queryKey: ['cities', currentOrg?.id],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });

  const { data: casts } = useQuery({
    queryKey: ['casts', currentOrg?.id],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from('casts').select('*').order('name');
      if (error) throw error;
      return data as Cast[];
    },
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

  const { data: eligibility } = useEligibleArtists(showId, showDateId, cityId);

  const tiersQ = useQuery({
    queryKey: ['offer-tiers', 'available', showDateId, cityId],
    enabled: canManage && !!showDateId,
    queryFn: () => fetchOfferTiers(supabase, { cityId, showDateId: showDateId! }),
  });
  const openedQ = useQuery({
    queryKey: ['offer-tiers', 'opened', showDateId],
    enabled: canManage && !!showDateId,
    queryFn: () => fetchOpenedTiers(supabase, showDateId!),
  });

  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelDate = useCancelShowDate();
  const deleteDate = useDeleteShowDate();
  const isAdmin = hasRole('admin');
  const bookingCount = (bookingsForDate ?? []).filter((b: { status: string }) => b.status !== 'cancelled').length;
  const synced = showDate ? isSyncedDate(showDate) : false;
  const deletable = isAdmin && showDate ? canHardDeleteDate({ synced, bookingCount }) : false;

  const tierOptions = useMemo(
    () => buildOfferTierOptions(tiersQ.data ?? { priorities: [], hasAdHoc: false }),
    [tiersQ.data]
  );
  // Fall back to the first option unless the explicit selection is still a valid
  // option (e.g. a city change can drop the previously-selected tier).
  const effectiveTier =
    selectedTier != null && tierOptions.some(o => o.value === selectedTier)
      ? selectedTier
      : tierOptions[0]?.value ?? null;
  const hasSession = !!(showDate?.session_1 || showDate?.session_2 || showDate?.session_3);
  // True if the tier has EVER been opened (open or closed). Re-opening a closed
  // tier should still show the additive "already opened" note — especially when it
  // was closed with offers kept live, so the producer knows offers will coexist.
  const alreadyOpened = (openedQ.data ?? []).some(o => o.tier === effectiveTier);

  // Dialog copy via pure helpers, computed once (null until usable).
  const confirmCopy = effectiveTier != null && showDate
    ? offerConfirmCopy({ tier: effectiveTier, dateLabel: formatDateDMY(showDate.date), alreadyOpened })
    : null;
  const closeCopy = closeTarget !== null
    ? closeConfirmCopy({ tier: closeTarget, pendingCount: pendingOfferCount(bookingsForDate ?? [], closeTarget) })
    : null;

  const {
    active: activeBookings,
    main: mainBookings,
    understudy: understudyBookings,
    bookedArtistIds,
    confirmedMainCount,
    confirmedUnderstudyCount,
  } = useMemo(() => deriveBookingGroups(bookingsForDate ?? []), [bookingsForDate]);

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
    onError: (err: any) => toast.error(err.message),
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
    onError: (err: any) => toast.error(err.message),
  });

  const createBooking = useMutation({
    mutationFn: async ({ artistId, isUnderstudy = false }: { artistId: string; isUnderstudy?: boolean }) => {
      if (!currentOrg) throw new Error('No active organization');
      const { error } = await supabase.from('bookings').insert({
        show_date_id: showDateId!,
        artist_id: artistId,
        status: 'soft_booked',
        is_understudy: isUnderstudy,
        booked_by: user!.id,
        org_id: currentOrg.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Artist booked');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateBookingStatus = useMutation({
    mutationFn: ({ bookingId, status }: { bookingId: string; status: 'confirmed' | 'cancelled' }) =>
      updateBookingStatusGuarded(supabase, { bookingId, status, now: new Date() }),
    onSuccess: ({ affected }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast.error('This booking changed — refresh and retry');
      } else {
        toast.success('Booking updated');
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openOffers = useMutation({
    mutationFn: (tier: number) => openOfferTier(supabase, { showDateId: showDateId!, tier }),
    onSuccess: (res, tier) => {
      const { kind, text } = offerResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      if (res.trackingWarning) {
        toast.error('Tier tracking failed to record — re-open the tier to restore escalation and at-risk alerts.');
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeOffers = useMutation({
    mutationFn: ({ tier, withdraw }: { tier: number; withdraw: boolean }) =>
      closeOfferTier(supabase, { showDateId: showDateId!, tier, withdraw }),
    onSuccess: (res, { tier }) => {
      const { kind, text } = closeResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
      setCloseTarget(null);
    },
    onError: (err: any) => { toast.error(err.message); setCloseTarget(null); },
  });

  const venue = showDate?.venue;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-base">
              {showDate ? showLabel(showDate.show) : 'Show Date'}
            </SheetTitle>
            {isEditorMode && isRealAdmin && (
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
                ShowDateDetailSheet.tsx
              </Badge>
            )}
          </SheetHeader>
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
                  {format(new Date(showDate.date + 'T00:00:00'), 'EEEE, d MMMM yyyy')}
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

              {/* Slots summary */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />Slots
                </p>
                {slotConfig ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Main cast</p>
                      <p className="font-medium">{confirmedMainCount} / {slotConfig.main_cast} confirmed</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Understudies</p>
                      <p className="font-medium">{confirmedUnderstudyCount} / {slotConfig.understudies} confirmed</p>
                    </div>
                  </div>
                ) : (
                  <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                    Slot config missing for {showDate.show?.program ?? '—'} / {showDate.show?.sub_program ?? '—'} — configure in Settings
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
                  </CardContent>
                </Card>
              )}

              {/* Date actions (edit / cancel / delete) */}
              {canManage && showDate.status !== 'cancelled' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
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

                  {isAdmin && (
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

              {/* Offers */}
              {canManage && showDate.status !== 'cancelled' && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base">Offers</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Opened tiers */}
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Opened tiers</p>
                      {openedQ.isLoading ? (
                        <Skeleton className="h-5 w-40" />
                      ) : (openedQ.data ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No tiers opened yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(openedQ.data ?? []).map(o => (
                            <Badge key={o.tier} variant="outline" className="flex items-center gap-2 py-1">
                              <span>
                                {o.tier === 99 ? 'Ad-hoc casts' : `Tier ${o.tier}`}
                                <span className="ml-1 opacity-60">
                                  {o.closedAt
                                    ? `· closed ${formatTimestampDMY(o.closedAt)}`
                                    : `· opened ${formatTimestampDMY(o.openedAt)}`}
                                </span>
                              </span>
                              {!o.closedAt && (
                                <button
                                  type="button"
                                  onClick={() => setCloseTarget(o.tier)}
                                  className="text-destructive hover:underline text-xs"
                                >
                                  Close
                                </button>
                              )}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Open a tier */}
                    {tiersQ.isLoading ? (
                      <Skeleton className="h-9 w-64" />
                    ) : tierOptions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No offer tiers configured for this city — set cast priorities in Settings → Cities &amp; Casts.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={effectiveTier != null ? String(effectiveTier) : undefined}
                          onValueChange={v => setSelectedTier(Number(v))}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Select tier" />
                          </SelectTrigger>
                          <SelectContent>
                            {tierOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button disabled={!hasSession || openOffers.isPending || effectiveTier == null}>
                              {openOffers.isPending
                                ? 'Opening…'
                                : `Open ${effectiveTier === 99 ? 'ad-hoc casts' : `tier ${effectiveTier}`}`}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            {effectiveTier != null && confirmCopy && (
                              <>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
                                  <AlertDialogDescription>{confirmCopy.body}</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => openOffers.mutate(effectiveTier)}>
                                    Open offers
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </>
                            )}
                          </AlertDialogContent>
                        </AlertDialog>

                        {!hasSession && (
                          <span className="text-xs text-muted-foreground">
                            Add a session time before opening offers.
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Close-tier confirmation (choose withdraw vs keep) */}
              <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
                <AlertDialogContent>
                  {closeTarget !== null && closeCopy && (
                    <>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{closeCopy.title}</AlertDialogTitle>
                        <AlertDialogDescription>{closeCopy.intro}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-2">
                        <AlertDialogAction asChild>
                          <button
                            type="button"
                            disabled={closeOffers.isPending}
                            onClick={() => closeOffers.mutate({ tier: closeTarget, withdraw: true })}
                            className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                          >
                            <p className="text-sm font-medium">{closeCopy.withdraw.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.withdraw.caption}</p>
                          </button>
                        </AlertDialogAction>
                        <AlertDialogAction asChild>
                          <button
                            type="button"
                            disabled={closeOffers.isPending}
                            onClick={() => closeOffers.mutate({ tier: closeTarget, withdraw: false })}
                            className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                          >
                            <p className="text-sm font-medium">{closeCopy.keep.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.keep.caption}</p>
                          </button>
                        </AlertDialogAction>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                      </AlertDialogFooter>
                    </>
                  )}
                </AlertDialogContent>
              </AlertDialog>

              {/* Assigned Artists */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />Assigned Artists
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activeBookings.length > 0 ? (
                    <div className="space-y-4">
                      {mainBookings.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Main cast</p>
                          {mainBookings.map(b => (
                            <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                              <div>
                                <p className="font-medium text-sm">{b.artist?.name}</p>
                                <Badge variant="secondary" className={`text-xs mt-1 ${BOOKING_STATUS_STYLE[b.status] ?? ''}`}>
                                  {b.status.replace('_', ' ')}
                                </Badge>
                              </div>
                              {canManage && (
                                <div className="flex gap-2">
                                  {b.status === 'soft_booked' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'confirmed' })}
                                    >
                                      Confirm
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'cancelled' })}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {understudyBookings.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Understudies</p>
                          {understudyBookings.map(b => (
                            <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                              <div>
                                <p className="font-medium text-sm">{b.artist?.name}</p>
                                <Badge variant="secondary" className={`text-xs mt-1 ${BOOKING_STATUS_STYLE[b.status] ?? ''}`}>
                                  {b.status.replace('_', ' ')}
                                </Badge>
                              </div>
                              {canManage && (
                                <div className="flex gap-2">
                                  {b.status === 'soft_booked' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'confirmed' })}
                                    >
                                      Confirm
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'cancelled' })}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No artists assigned yet</p>
                  )}
                </CardContent>
              </Card>

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
