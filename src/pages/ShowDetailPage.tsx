import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { Plus, CalendarDays, Users, Check, ChevronsUpDown, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateWithWeekday } from '@/lib/dates';
import type { Show, ShowDate, Booking, Artist, City, Cast } from '@/types';
import { showLabel } from '@/types';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useEligibleArtists } from '@/hooks/useEligibleArtists';

interface Props {
  /** When provided (e.g. inside a sheet), use this id instead of the route param. */
  idOverride?: string;
}

export default function ShowDetailPage({ idOverride }: Props = {}) {
  const params = useParams<{ id: string }>();
  const id = idOverride ?? params.id;
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [dateForm, setDateForm] = useState({ date: '', start_time: '', end_time: '', notes: '' });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const canManage = hasRole('admin') || hasRole('producer');

  const { data: show } = useQuery({
    queryKey: ['show', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('shows').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Show;
    },
  });

  const { data: showDates } = useQuery({
    queryKey: ['show-dates', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select('*')
        .eq('show_id', id!)
        .order('date', { ascending: true });
      if (error) throw error;
      return data as ShowDate[];
    },
  });

  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });

  const { data: casts } = useQuery({
    queryKey: ['casts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('casts').select('*').order('name');
      if (error) throw error;
      return data as Cast[];
    },
  });

  const selectedDateObj = useMemo(
    () => showDates?.find(d => d.id === selectedDate) ?? null,
    [showDates, selectedDate]
  );

  const { data: dateCastOverrides } = useQuery({
    queryKey: ['show-date-cast-eligibility', selectedDate],
    enabled: !!selectedDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_date_cast_eligibility')
        .select('id, cast_id')
        .eq('show_date_id', selectedDate!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: eligibility } = useEligibleArtists(id, selectedDate, selectedDateObj?.city_id ?? null);

  const { data: bookingsForDate } = useQuery({
    queryKey: ['bookings-for-date', selectedDate],
    enabled: !!selectedDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, artist:artists(name, skills, priority_score)')
        .eq('show_date_id', selectedDate!);
      if (error) throw error;
      return data as (Booking & { artist: Artist })[];
    },
  });

  const { data: availableArtists } = useQuery({
    queryKey: ['available-artists', selectedDate],
    enabled: !!selectedDate,
    queryFn: async () => {
      const dateObj = showDates?.find(d => d.id === selectedDate);
      if (!dateObj) return [];
      const { data, error } = await supabase
        .from('artists')
        .select('*, availability!inner(status)')
        .eq('status', 'active')
        .eq('availability.date', dateObj.date)
        .eq('availability.status', 'available');
      if (error) throw error;
      return (data ?? []) as Artist[];
    },
  });

  // Filter available by cast eligibility
  const filteredAvailable = useMemo(() => {
    if (!availableArtists) return [];
    if (!eligibility?.artistIds) return availableArtists; // no restriction yet
    return availableArtists.filter(a => eligibility.artistIds!.has(a.id));
  }, [availableArtists, eligibility]);

  const createDate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('show_dates').insert({
        show_id: id!,
        date: dateForm.date,
        start_time: dateForm.start_time || null,
        end_time: dateForm.end_time || null,
        notes: dateForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show-dates', id] });
      setDateDialogOpen(false);
      setDateForm({ date: '', start_time: '', end_time: '', notes: '' });
      toast({ title: 'Date added' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const updateDateCity = useMutation({
    mutationFn: async ({ dateId, cityId }: { dateId: string; cityId: string | null }) => {
      const { error } = await supabase.from('show_dates').update({ city_id: cityId }).eq('id', dateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show-dates', id] });
      queryClient.invalidateQueries({ queryKey: ['eligible-artists'] });
      toast({ title: 'City updated' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const toggleDateCast = useMutation({
    mutationFn: async ({ castId, on }: { castId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('show_date_cast_eligibility')
          .insert({ show_date_id: selectedDate!, cast_id: castId });
        if (error) throw error;
      } else {
        const row = dateCastOverrides?.find(r => r.cast_id === castId);
        if (!row) return;
        const { error } = await supabase.from('show_date_cast_eligibility').delete().eq('id', row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show-date-cast-eligibility', selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['eligible-artists'] });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const createBooking = useMutation({
    mutationFn: async ({ artistId, isUnderstudy = false }: { artistId: string; isUnderstudy?: boolean }) => {
      const { error } = await supabase.from('bookings').insert({
        show_date_id: selectedDate!,
        artist_id: artistId,
        status: 'soft_booked',
        is_understudy: isUnderstudy,
        booked_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-for-date', selectedDate] });
      toast({ title: 'Artist booked' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const updateBookingStatus = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const updates: any = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
      const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-for-date', selectedDate] });
      toast({ title: 'Booking updated' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const statusColor: Record<string, string> = {
    suggested: 'bg-info/10 text-info',
    soft_booked: 'bg-warning/10 text-warning',
    confirmed: 'bg-success/10 text-success',
    cancelled: 'bg-destructive/10 text-destructive',
    open: 'bg-muted text-muted-foreground',
    partially_filled: 'bg-warning/10 text-warning',
    fully_filled: 'bg-success/10 text-success',
  };

  if (!show) return <div className="animate-pulse h-48 rounded-lg bg-muted" />;

  const selectedCityId = selectedDateObj?.city_id ?? null;
  const overrideCastIds = new Set((dateCastOverrides ?? []).map(r => r.cast_id));
  const inheritedCastIds = new Set(
    (eligibility?.castIds ?? []).filter(cid => !overrideCastIds.has(cid))
  );

  return (
    <div className="space-y-6">
      {/* Show header */}
      <div>
        <h1 className="font-display text-3xl font-bold">{showLabel(show)}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Badge className={statusColor[show.status] ?? ''} variant="secondary">{show.status}</Badge>
          {show.venue && <span className="text-sm text-muted-foreground">{show.venue}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dates list */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Dates</h2>
            {canManage && (
              <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle className="font-display">Add Show Date</DialogTitle></DialogHeader>
                  <form onSubmit={e => { e.preventDefault(); createDate.mutate(); }} className="space-y-4">
                    <Input type="date" value={dateForm.date} onChange={e => setDateForm(f => ({ ...f, date: e.target.value }))} required />
                    <div className="grid grid-cols-2 gap-3">
                      <Input type="time" placeholder="Start" value={dateForm.start_time} onChange={e => setDateForm(f => ({ ...f, start_time: e.target.value }))} />
                      <Input type="time" placeholder="End" value={dateForm.end_time} onChange={e => setDateForm(f => ({ ...f, end_time: e.target.value }))} />
                    </div>
                    <Input placeholder="Notes" value={dateForm.notes} onChange={e => setDateForm(f => ({ ...f, notes: e.target.value }))} />
                    <Button type="submit" className="w-full" disabled={createDate.isPending}>Add Date</Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="space-y-2">
            {showDates?.map(d => (
              <button
                key={d.id}
                onClick={() => setSelectedDate(d.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedDate === d.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{formatDateWithWeekday(d.date)}</p>
                    {d.start_time && <p className="text-xs text-muted-foreground">{d.start_time}{d.end_time ? ` - ${d.end_time}` : ''}</p>}
                    {d.city_id && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cities?.find(c => c.id === d.city_id)?.name}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusColor[d.status] ?? ''}`}>{d.status.replace('_', ' ')}</Badge>
                </div>
              </button>
            ))}
            {showDates?.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No dates yet</p>}
          </div>
        </div>

        {/* Booking + chat panel */}
        <div className="lg:col-span-2">
          {selectedDate && selectedDateObj ? (
            <Tabs defaultValue="bookings" className="space-y-4">
              <TabsList>
                <TabsTrigger value="bookings"><Users className="h-4 w-4 mr-2" />Bookings</TabsTrigger>
                <TabsTrigger value="chat"><MessageSquare className="h-4 w-4 mr-2" />Chat</TabsTrigger>
              </TabsList>

              <TabsContent value="bookings" className="space-y-6">
                {/* Date config: city + per-date cast overrides */}
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
                            value={selectedDateObj.city_id ?? 'none'}
                            onValueChange={(v) => updateDateCity.mutate({
                              dateId: selectedDateObj.id,
                              cityId: v === 'none' ? null : v,
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select city" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— None —</SelectItem>
                              {cities?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Extra eligible casts (this date)</label>
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
                              {casts?.find(c => c.id === cid)?.name} <span className="ml-1 opacity-60">inherited</span>
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

                {/* Current bookings */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-lg flex items-center gap-2">
                      <Users className="h-5 w-5" />Assigned Artists
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {bookingsForDate && bookingsForDate.length > 0 ? (
                      <div className="space-y-3">
                        {bookingsForDate.map((b: any) => (
                          <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                            <div>
                              <p className="font-medium text-sm">{b.artist?.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className={`text-xs ${statusColor[b.status]}`}>{b.status.replace('_', ' ')}</Badge>
                                {b.is_understudy && <Badge variant="outline" className="text-xs">Understudy</Badge>}
                              </div>
                            </div>
                            {canManage && b.status !== 'cancelled' && (
                              <div className="flex gap-2">
                                {b.status === 'soft_booked' && (
                                  <Button size="sm" variant="outline" onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'confirmed' })}>
                                    Confirm
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateBookingStatus.mutate({ bookingId: b.id, status: 'cancelled' })}>
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No artists assigned yet</p>
                    )}
                  </CardContent>
                </Card>

                {/* Available artists to book */}
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
                      {filteredAvailable && filteredAvailable.length > 0 ? (
                        <div className="space-y-2">
                          {filteredAvailable.map((a: any) => (
                            <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                              <div>
                                <p className="font-medium text-sm">{a.name}</p>
                                <p className="text-xs text-muted-foreground">Priority: {a.priority_score} • {a.skills?.join(', ') || 'No skills listed'}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => createBooking.mutate({ artistId: a.id })}>Book</Button>
                                <Button size="sm" variant="outline" onClick={() => createBooking.mutate({ artistId: a.id, isUnderstudy: true })}>Understudy</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : eligibility?.artistIds && eligibility.artistIds.size === 0 ? (
                        <p className="text-sm text-muted-foreground">No artists in the eligible casts. Add members to the casts or relax eligibility.</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">No available artists for this date. Artists need to mark their availability first.</p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="chat">
                <ChatPanel showDateId={selectedDate} showDate={selectedDateObj.date} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <div className="text-center">
                <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Select a date to manage bookings</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
