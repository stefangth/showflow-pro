import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { BanIcon } from 'lucide-react';

interface Props {
  artistId: string;
  /** YYYY-MM-DD */
  date: string;
  size?: 'sm' | 'default';
}

/**
 * Blocked-date toggle: inserts or removes a blocked_dates row.
 * Used in the calendar popover and availability page table.
 */
export function AvailabilityPicker({ artistId, date, size = 'default' }: Props) {
  const qc = useQueryClient();

  const { data: block } = useQuery({
    queryKey: ['blocked-dates', 'cell', artistId, date],
    queryFn: async () => {
      const { data } = await supabase
        .from('blocked_dates')
        .select('id')
        .eq('artist_id', artistId)
        .eq('date', date)
        .maybeSingle();
      return data as { id: string } | null;
    },
  });

  const toggle = useMutation({
    mutationFn: async () => {
      if (block) {
        const { error } = await supabase.from('blocked_dates').delete().eq('id', block.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('blocked_dates').insert({ artist_id: artistId, date });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
    },
  });

  return (
    <Button
      size={size === 'sm' ? 'sm' : 'default'}
      variant={block ? 'destructive' : 'outline'}
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      className="w-full text-xs"
    >
      <BanIcon className="h-3 w-3 mr-1" />
      {block ? 'Blocked' : 'Block date'}
    </Button>
  );
}
