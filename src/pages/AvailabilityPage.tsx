import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function AvailabilityPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Get artist record for current user
  const { data: artist } = useQuery({
    queryKey: ['my-artist', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('artists').select('*').eq('user_id', user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Get availability for the month
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const { data: availability } = useQuery({
    queryKey: ['my-availability', artist?.id, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data } = await supabase
        .from('availability')
        .select('*')
        .eq('artist_id', artist!.id)
        .gte('date', format(monthStart, 'yyyy-MM-dd'))
        .lte('date', format(monthEnd, 'yyyy-MM-dd'));
      return data ?? [];
    },
    enabled: !!artist,
  });

  // Get bookings for the month
  const { data: myBookings } = useQuery({
    queryKey: ['my-bookings', artist?.id, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, show_date:show_dates(date, show:shows(title))')
        .eq('artist_id', artist!.id)
        .neq('status', 'cancelled');
      return data ?? [];
    },
    enabled: !!artist,
  });

  const toggleAvailability = useMutation({
    mutationFn: async (date: string) => {
      const existing = availability?.find(a => a.date === date);
      if (existing) {
        const cycle = { available: 'unavailable', unavailable: 'tentative', tentative: 'delete' } as const;
        const next = cycle[existing.status as keyof typeof cycle] ?? 'delete';
        if (next === 'delete') {
          await supabase.from('availability').delete().eq('id', existing.id);
        } else {
          await supabase.from('availability').update({ status: next as 'available' | 'unavailable' | 'tentative' }).eq('id', existing.id);
        }
      } else {
        await supabase.from('availability').insert({ artist_id: artist!.id, date, status: 'available' });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-availability'] }),
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const availMap = useMemo(() => {
    const map: Record<string, string> = {};
    availability?.forEach(a => { map[a.date] = a.status; });
    return map;
  }, [availability]);

  const bookingMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    myBookings?.forEach((b: any) => {
      const d = b.show_date?.date;
      if (d) { if (!map[d]) map[d] = []; map[d].push(b); }
    });
    return map;
  }, [myBookings]);

  const statusStyles: Record<string, string> = {
    available: 'bg-success/20 border-success text-success hover:bg-success/30',
    unavailable: 'bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30',
    tentative: 'bg-warning/20 border-warning text-warning hover:bg-warning/30',
  };

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Availability</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No artist profile linked to your account. Ask an admin to link your account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">My Availability</h1>
        <p className="text-muted-foreground mt-1">Click dates to toggle: available → unavailable → tentative → clear</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="font-display">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for first week offset */}
            {Array.from({ length: monthStart.getDay() }).map((_, i) => <div key={`empty-${i}`} />)}
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const status = availMap[dateStr];
              const dayBookings = bookingMap[dateStr];
              return (
                <button
                  key={dateStr}
                  onClick={() => toggleAvailability.mutate(dateStr)}
                  className={`relative p-2 rounded-lg border text-center min-h-[60px] transition-colors ${
                    status ? statusStyles[status] : 'border-border hover:bg-muted'
                  } ${isToday(day) ? 'ring-2 ring-primary' : ''}`}
                >
                  <span className={`text-sm ${isToday(day) ? 'font-bold' : ''}`}>{format(day, 'd')}</span>
                  {dayBookings && (
                    <div className="mt-1">
                      {dayBookings.map((b: any) => (
                        <div key={b.id} className="text-[10px] truncate bg-primary/10 text-primary rounded px-1">
                          {b.show_date?.show?.title}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
            <span className="text-xs text-muted-foreground">Legend:</span>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-success/30" /><span className="text-xs">Available</span></div>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-destructive/30" /><span className="text-xs">Unavailable</span></div>
            <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-warning/30" /><span className="text-xs">Tentative</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
