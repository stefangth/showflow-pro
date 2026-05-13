import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, MapPin, Clock, Users } from 'lucide-react';
import { showLabel } from '@/types';
import { useSubProgramSlots, effectiveSlots } from '@/hooks/useSubProgramSlots';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ROUTES } from '@/config/app.config';
import type { Booking, Artist } from '@/types';

interface Props {
  showDateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BookingWithArtist = Booking & { artist: Artist };
type AvailForDate = { id: string; name: string; priority_score: number | null; skills: string[] | null };

export function ShowDateDetailSheet({ showDateId, open, onOpenChange }: Props) {
  const slotDefaults = useSubProgramSlots();

  const { data: showDate, isLoading } = useQuery({
    queryKey: ['show-date-detail', showDateId],
    enabled: !!showDateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select(`
          id, date, start_time, end_time, venue_override, status, notes, city_id, show_id,
          show:shows(id, program, sub_program, venue, status),
          city:cities(id, name)
        `)
        .eq('id', showDateId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: bookingRows } = useQuery({
    queryKey: ['bookings', 'show-date', showDateId],
    enabled: !!showDateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, artist:artists(id, name, email, skills, status)')
        .eq('show_date_id', showDateId!)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingWithArtist[];
    },
  });

  const { data: availableArtists } = useQuery({
    queryKey: ['availability', 'for-date', showDate?.date],
    enabled: !!showDate?.date,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artists')
        .select('id, name, priority_score, skills, availability!inner(status, date)')
        .eq('status', 'active')
        .eq('availability.date', showDate!.date)
        .in('availability.status', ['available', 'tentative']);
      if (error) throw error;
      return (data ?? []) as AvailForDate[];
    },
  });

  const mainBookings = bookingRows?.filter(b => !b.is_understudy) ?? [];
  const understudyBookings = bookingRows?.filter(b => b.is_understudy) ?? [];

  const bookedArtistIds = useMemo(
    () => new Set(bookingRows?.map(b => b.artist_id) ?? []),
    [bookingRows]
  );
  const availableNotBooked = useMemo(
    () => (availableArtists ?? []).filter(a => !bookedArtistIds.has(a.id)),
    [availableArtists, bookedArtistIds]
  );

  const config = showDate ? effectiveSlots(slotDefaults, showDate.show?.sub_program ?? null) : null;

  const confirmedMain = mainBookings.filter(b => b.status === 'confirmed').length;
  const confirmedUs = understudyBookings.filter(b => b.status === 'confirmed').length;

  const venue = showDate?.venue_override ?? showDate?.show?.venue;

  const bookingStatusStyle: Record<string, string> = {
    confirmed: 'bg-success/10 text-success',
    soft_booked: 'bg-warning/10 text-warning',
    suggested: 'bg-muted text-muted-foreground',
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex items-center justify-between">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-base">
              {showDate ? showLabel(showDate.show) : 'Show Date'}
            </SheetTitle>
          </SheetHeader>
          {showDate?.show?.id && (
            <Link to={`${ROUTES.SHOWS}/${showDate.show.id}`}>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <ExternalLink className="h-4 w-4 mr-2" />All dates
              </Button>
            </Link>
          )}
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
              {/* Header info */}
              <div className="space-y-2">
                <p className="font-display text-2xl font-bold">
                  {format(new Date(showDate.date + 'T00:00:00'), 'EEEE, d MMMM yyyy')}
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  {showDate.start_time && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {showDate.start_time.slice(0, 5)}
                      {showDate.end_time && ` – ${showDate.end_time.slice(0, 5)}`}
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
                {config ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Main cast</p>
                      <p className="font-medium">{confirmedMain} / {config.main_cast} confirmed</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Understudies</p>
                      <p className="font-medium">{confirmedUs} / {config.understudies} confirmed</p>
                    </div>
                  </div>
                ) : (
                  <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                    Slot config missing for this sub-program — configure in Settings
                  </Badge>
                )}
              </div>

              {/* Bookings */}
              {(mainBookings.length > 0 || understudyBookings.length > 0) && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Cast</p>
                  {mainBookings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Main</p>
                      {mainBookings.map(b => (
                        <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                          <span className="text-sm font-medium">{b.artist?.name}</span>
                          <Badge variant="secondary" className={bookingStatusStyle[b.status] ?? ''}>
                            {b.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {understudyBookings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Understudies</p>
                      {understudyBookings.map(b => (
                        <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                          <span className="text-sm font-medium">{b.artist?.name}</span>
                          <Badge variant="secondary" className={bookingStatusStyle[b.status] ?? ''}>
                            {b.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Available to Book */}
              {availableNotBooked.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Available to Book</p>
                  <div className="space-y-1">
                    {availableNotBooked.map(a => (
                      <div key={a.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                        <div>
                          <p className="text-sm font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Priority: {a.priority_score ?? '—'}
                            {a.skills?.length ? ` • ${a.skills.join(', ')}` : ''}
                          </p>
                        </div>
                        <Badge variant="secondary" className="bg-success/10 text-success">Available</Badge>
                      </div>
                    ))}
                  </div>
                </div>
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
