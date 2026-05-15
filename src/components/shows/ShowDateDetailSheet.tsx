import { useMemo } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Clock, Users, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showLabel } from '@/types';
import { useEligibleArtists } from '@/hooks/useEligibleArtists';
import { useSubProgramSlots, effectiveSlots } from '@/hooks/useSubProgramSlots';
import { ChatPanel } from '@/components/chat/ChatPanel';
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
  const { hasRole, user, roles } = useAuth();
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
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id,
          show:shows(id, program, sub_program),
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
  const slotDefaults = useSubProgramSlots();
  const slotConfig = effectiveSlots(slotDefaults, showDate?.show?.program, showDate?.show?.sub_program);

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
    queryKey: ['cities'],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });

  const { data: casts } = useQuery({
    queryKey: ['casts'],
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

  const { data: availableArtists } = useQuery({
    queryKey: ['availability', 'available', showDateId],
    enabled: !!showDate?.date && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artists')
        .select('*, availability!inner(status)')
        .eq('status', 'active')
        .eq('availability.date', showDate!.date)
        .eq('availability.status', 'available');
      if (error) throw error;
      return (data ?? []) as Artist[];
    },
  });

  const activeBookings = useMemo(
    () => (bookingsForDate ?? []).filter(b => b.status !== 'cancelled'),
    [bookingsForDate]
  );
  const mainBookings = useMemo(() => activeBookings.filter(b => !b.is_understudy), [activeBookings]);
  const understudyBookings = useMemo(() => activeBookings.filter(b => b.is_understudy), [activeBookings]);

  const bookedArtistIds = useMemo(
    () => new Set(activeBookings.map(b => b.artist_id)),
    [activeBookings]
  );

  const filteredAvailable = useMemo(() => {
    if (!availableArtists) return [];
    const notBooked = availableArtists.filter(a => !bookedArtistIds.has(a.id));
    if (!eligibility?.artistIds) return notBooked;
    return notBooked.filter(a => eligibility.artistIds!.has(a.id));
  }, [availableArtists, bookedArtistIds, eligibility]);

  const overrideCastIds = useMemo(
    () => new Set((dateCastOverrides ?? []).map(r => r.cast_id)),
    [dateCastOverrides]
  );
  const inheritedCastIds = useMemo(
    () => new Set((eligibility?.castIds ?? []).filter(cid => !overrideCastIds.has(cid))),
    [eligibility, overrideCastIds]
  );

  const confirmedMainCount = useMemo(
    () => activeBookings.filter(b => b.status === 'confirmed' && !b.is_understudy).length,
    [activeBookings]
  );
  const confirmedUnderstudyCount = useMemo(
    () => activeBookings.filter(b => b.status === 'confirmed' && b.is_understudy).length,
    [activeBookings]
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
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      queryClient.invalidateQueries({ queryKey: ['show-date-detail', showDateId] });
      toast.success('City updated');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleDateCast = useMutation({
    mutationFn: async ({ castId, on }: { castId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('show_date_cast_eligibility')
          .insert({ show_date_id: showDateId!, cast_id: castId });
        if (error) throw error;
      } else {
        const row = dateCastOverrides?.find(r => r.cast_id === castId);
        if (!row) return;
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
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createBooking = useMutation({
    mutationFn: async ({ artistId, isUnderstudy = false }: { artistId: string; isUnderstudy?: boolean }) => {
      const { error } = await supabase.from('bookings').insert({
        show_date_id: showDateId!,
        artist_id: artistId,
        status: 'soft_booked',
        is_understudy: isUnderstudy,
        booked_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success('Artist booked');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateBookingStatus = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const updates: Record<string, unknown> = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
      const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Booking updated');
    },
    onError: (err: any) => toast.error(err.message),
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
                <p className="font-display text-2xl font-bold">
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
                      <div className="flex flex-wrap gap-1">
                        {Array.from(inheritedCastIds).map(cid => (
                          <Badge key={cid} variant="outline" className="text-xs">
                            {casts?.find(c => c.id === cid)?.name}
                            <span className="ml-1 opacity-60">inherited</span>
                          </Badge>
                        ))}
                        {Array.from(overrideCastIds).map(cid => (
                          <Badge key={cid} variant="secondary" className="text-xs">
                            {casts?.find(c => c.id === cid)?.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

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

              {/* Available Artists (producer/admin only) */}
              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-lg">Available Artists</CardTitle>
                    {eligibility?.artistIds && (
                      <p className="text-xs text-muted-foreground">
                        Filtered by eligible casts ({eligibility.castIds.length} cast{eligibility.castIds.length === 1 ? '' : 's'})
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {filteredAvailable.length > 0 ? (
                      <div className="space-y-2">
                        {filteredAvailable.map(a => (
                          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                            <div>
                              <p className="font-medium text-sm">{a.name}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => createBooking.mutate({ artistId: a.id })}>
                                Book
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => createBooking.mutate({ artistId: a.id, isUnderstudy: true })}
                              >
                                Understudy
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : eligibility?.artistIds && eligibility.artistIds.size === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No artists in the eligible casts. Add members to the casts or relax eligibility.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No available artists for this date. Artists need to mark their availability first.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Chat */}
              <ChatPanel showDateId={showDate.id} showDate={showDate.date} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
