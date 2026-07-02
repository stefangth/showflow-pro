import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Booking, Artist } from '@/types';

type BookingWithArtist = Booking & { artist: Pick<Artist, 'id' | 'name'> };

const BOOKING_STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-success/10 text-success',
  soft_booked: 'bg-warning/10 text-warning',
  suggested: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
};

interface BookingRowProps {
  booking: BookingWithArtist;
  canManage: boolean;
  onConfirm: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}

/**
 * A single assigned-artist row (name + status badge + confirm/cancel actions).
 * Shared by the Main-cast and Understudies lists in ShowDateDetailSheet — the two
 * were byte-identical before extraction. Pure presentational: status transitions
 * remain owned by the parent's guarded mutation via the onConfirm/onCancel callbacks.
 */
export function BookingRow({ booking: b, canManage, onConfirm, onCancel }: BookingRowProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border">
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
              onClick={() => onConfirm(b.id)}
            >
              Confirm
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => onCancel(b.id)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
