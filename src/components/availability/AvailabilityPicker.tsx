import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Database } from '@/integrations/supabase/types';

type AvailabilityStatus = Database['public']['Enums']['availability_status'];

interface Props {
  artistId: string;
  /** YYYY-MM-DD */
  date: string;
  /** Compact size (for calendar popovers). */
  size?: 'sm' | 'default';
}

const STATUS_OPTIONS: { value: AvailabilityStatus | 'clear'; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Not available' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'clear', label: 'Clear response' },
];

/**
 * A self-contained Available / Not available / Tentative selector
 * that upserts into the `availability` table.
 */
export function AvailabilityPicker({ artistId, date, size = 'default' }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: row } = useQuery({
    queryKey: ['availability', 'cell', artistId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability')
        .select('id, status')
        .eq('artist_id', artistId)
        .eq('date', date)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; status: AvailabilityStatus } | null;
    },
  });

  const setStatus = useMutation({
    mutationFn: async (next: AvailabilityStatus | 'clear') => {
      if (next === 'clear') {
        if (!row) return;
        const { error } = await supabase.from('availability').delete().eq('id', row.id);
        if (error) throw error;
        return;
      }
      if (row) {
        const { error } = await supabase
          .from('availability')
          .update({ status: next })
          .eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('availability')
          .insert({ artist_id: artistId, date, status: next });
        if (error) throw error;
      }
    },
    onSuccess: async (_data, next) => {
      qc.invalidateQueries({ queryKey: ['availability'] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });

      if (next === 'available') {
        // Trigger auto-suggest for all non-cancelled show dates on this day
        const { data: dates } = await supabase
          .from('show_dates')
          .select('id')
          .eq('date', date)
          .neq('status', 'cancelled');

        if (dates && dates.length > 0) {
          await Promise.allSettled(
            dates.map(d =>
              supabase.functions.invoke('auto-suggest-bookings', { body: { show_date_id: d.id } })
            )
          );
          qc.invalidateQueries({ queryKey: ['bookings'] });
          toast({
            title: 'Availability updated',
            description: `Suggestions triggered for ${dates.length} show date${dates.length === 1 ? '' : 's'}.`,
          });
        } else {
          toast({ title: 'Availability updated' });
        }
      } else {
        toast({ title: 'Availability updated' });
      }
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    // `key` forces Radix Select to fully re-mount when the row is cleared,
    // so the placeholder shows again and the artist can pick a new status
    // without needing a page refresh.
    <Select
      key={row?.status ?? 'empty'}
      value={row?.status ?? undefined}
      onValueChange={(v) => setStatus.mutate(v as any)}
    >
      <SelectTrigger className={size === 'sm' ? 'h-8 text-xs' : ''}>
        <SelectValue placeholder="Set availability…" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
