import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  bookingId: string;
  size?: 'sm' | 'default';
}

/**
 * Accept / Decline buttons for a pending offer (suggested booking).
 * Accept → soft_booked; Decline → cancelled (artist_declined).
 */
export function OfferResponseButtons({ bookingId, size = 'default' }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const respond = useMutation({
    mutationFn: async (accept: boolean) => {
      const updates: Record<string, unknown> = {
        status: accept ? 'soft_booked' : 'cancelled',
      };
      if (!accept) {
        updates.cancelled_at = new Date().toISOString();
        updates.cancellation_reason = 'artist_declined';
      }
      const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: (_data, accept) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      toast({ title: accept ? 'Offer accepted' : 'Offer declined' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const btnSize = size === 'sm' ? 'sm' : 'default';

  return (
    <div className="flex gap-1.5">
      <Button
        size={btnSize}
        variant="outline"
        className="flex-1 text-xs border-success/40 text-success hover:bg-success/10"
        onClick={() => respond.mutate(true)}
        disabled={respond.isPending}
      >
        <Check className="h-3 w-3 mr-1" />
        Accept
      </Button>
      <Button
        size={btnSize}
        variant="outline"
        className="flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
        onClick={() => respond.mutate(false)}
        disabled={respond.isPending}
      >
        <X className="h-3 w-3 mr-1" />
        Decline
      </Button>
    </div>
  );
}
