import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
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
  const { currentOrg } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation('availability');

  const { data: block, isError } = useQuery({
    queryKey: ['blocked-dates', 'cell', artistId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_dates')
        .select('id')
        .eq('artist_id', artistId)
        .eq('date', date)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string } | null;
    },
  });

  const toggle = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error('No active organization');
      if (block) {
        const { error } = await supabase.from('blocked_dates').delete().eq('id', block.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('blocked_dates').insert({ artist_id: artistId, date, org_id: currentOrg.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
    },
  });

  if (isError) {
    return (
      <p className="w-full text-xs text-destructive text-center" role="alert">
        {t('picker.loadError')}
      </p>
    );
  }

  return (
    <Button
      size={size === 'sm' ? 'sm' : 'default'}
      variant={block ? 'destructive' : 'outline'}
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      className="w-full text-xs"
    >
      <BanIcon className="h-3 w-3 mr-1" />
      {block ? t('picker.blocked') : t('picker.blockDate')}
    </Button>
  );
}
