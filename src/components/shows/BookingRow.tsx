import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { bookingStatusBadgeClass, bookingStatusDisplayLabel } from '@/lib/bookings';
import type { Booking, Artist } from '@/types';

type BookingWithArtist = Booking & { artist: Pick<Artist, 'id' | 'name'> };

interface BookingRowProps {
  booking: BookingWithArtist;
  canManage: boolean;
  showConfirm: boolean;
  onConfirm: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}

/**
 * A single assigned-artist row (name + status badge + confirm/cancel actions).
 * Shared by the Main-cast and Understudies lists in ShowDateDetailSheet — the two
 * were byte-identical before extraction. Pure presentational: status transitions
 * remain owned by the parent's guarded mutation via the onConfirm/onCancel callbacks.
 * `showConfirm` gates the Confirm action separately from `b.status` so a caller using
 * an auto-confirm booking flow (no manual confirm step) can hide it entirely.
 */
export function BookingRow({ booking: b, canManage, showConfirm, onConfirm, onCancel }: BookingRowProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border">
      <div>
        <p className="font-medium text-sm">{b.artist?.name}</p>
        <Badge variant="secondary" className={`text-xs mt-1 ${bookingStatusBadgeClass(b.status)}`}>
          {bookingStatusDisplayLabel(b.status)}
        </Badge>
      </div>
      {canManage && (
        <div className="flex gap-2">
          {showConfirm && b.status === 'soft_booked' && (
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
