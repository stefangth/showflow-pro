import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { respondToOffer } from '@/data/bookings';
import { useBookingFlow } from '@/hooks/useBookingFlow';
import { acceptConsequenceNote } from '@/lib/bookings/actionCopy';

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
  const { t } = useTranslation('availability');
  const { t: tAction } = useTranslation('bookingCopy');
  const { data: flow, isLoading: isFlowLoading } = useBookingFlow();
  // Auto-confirm on accept when the org's flow skips producer confirmation.
  const autoConfirm = !(flow?.producer_confirmation ?? true);

  const respond = useMutation({
    mutationFn: (accept: boolean) => respondToOffer(supabase, { bookingId, accept, now: new Date(), autoConfirm }),
    onSuccess: ({ affected }, accept) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      if (affected === 0) {
        toast({
          title: t('offer.toast.unavailableTitle'),
          description: t('offer.toast.unavailableDesc'),
          variant: 'destructive',
        });
        return;
      }
      if (accept) {
        const note = acceptConsequenceNote(flow, tAction);
        toast({ title: note.title, description: note.description });
      } else {
        toast({
          title: t('offer.toast.declinedTitle'),
          description: t('offer.toast.declinedDesc'),
        });
      }
    },
    onError: (e: Error) => toast({ title: t('offer.toast.errorTitle'), description: e.message, variant: 'destructive' }),
  });

  const btnSize = size === 'sm' ? 'sm' : 'default';

  return (
    <div className="flex gap-1.5">
      <Button
        size={btnSize}
        variant="outline"
        className="flex-1 text-xs border-success/40 text-success hover:bg-success/10"
        onClick={() => respond.mutate(true)}
        disabled={respond.isPending || isFlowLoading}
      >
        <Check className="h-3 w-3 mr-1" />
        {t('offer.accept')}
      </Button>
      <Button
        size={btnSize}
        variant="outline"
        className="flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
        onClick={() => respond.mutate(false)}
        disabled={respond.isPending}
      >
        <X className="h-3 w-3 mr-1" />
        {t('offer.decline')}
      </Button>
    </div>
  );
}
