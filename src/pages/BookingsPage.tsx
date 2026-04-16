import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useState } from 'react';

export default function BookingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['all-bookings', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bookings')
        .select('*, artist:artists(name), show_date:show_dates(date, start_time, show:shows(title, venue))')
        .order('created_at', { ascending: false })
        .limit(100);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
      const { error } = await supabase.from('bookings').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bookings'] });
      toast({ title: 'Booking updated' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const statusColor: Record<string, string> = {
    suggested: 'bg-info/10 text-info',
    soft_booked: 'bg-warning/10 text-warning',
    confirmed: 'bg-success/10 text-success',
    cancelled: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Bookings</h1>
          <p className="text-muted-foreground mt-1">View and manage all bookings</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="suggested">Suggested</SelectItem>
            <SelectItem value="soft_booked">Soft Booked</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {bookings?.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="py-4 flex items-center justify-between flex-wrap gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="font-medium">{b.artist?.name ?? 'Unknown'}</p>
                    <Badge variant="secondary" className={statusColor[b.status] ?? ''}>{b.status.replace('_', ' ')}</Badge>
                    {b.is_understudy && <Badge variant="outline" className="text-xs">Understudy</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {b.show_date?.show?.title} — {b.show_date?.date ? format(new Date(b.show_date.date), 'MMM d, yyyy') : ''}
                    {b.show_date?.show?.venue ? ` @ ${b.show_date.show.venue}` : ''}
                  </p>
                </div>
                {b.status !== 'cancelled' && b.status !== 'confirmed' && (
                  <div className="flex gap-2">
                    {b.status === 'soft_booked' && (
                      <Button size="sm" onClick={() => updateStatus.mutate({ id: b.id, status: 'confirmed' })}>Confirm</Button>
                    )}
                    {b.status === 'suggested' && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: 'soft_booked' })}>Soft Book</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus.mutate({ id: b.id, status: 'cancelled' })}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {bookings?.length === 0 && <p className="text-muted-foreground text-center py-12">No bookings found</p>}
        </div>
      )}
    </div>
  );
}
