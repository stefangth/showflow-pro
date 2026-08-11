import { Theater } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shown to an artist-role user whose account exists but is not yet linked to a
 * catalog artist row (useMyArtist returns null). The Dashboard and the
 * Availability page both dead-end on the same `if (!artist)` branch, so they
 * render this one card rather than each wording the state on their own — a warm
 * card on one surface and a cold "ask an admin" line on the next is exactly the
 * inconsistency this shared component removes. Each page keeps its own heading;
 * this is only the reassuring body card.
 */
export function UnlinkedArtistCard({ orgName }: { orgName?: string | null }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 text-accent-700">
          <Theater className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg font-semibold">
            {orgName ? `You're on the ${orgName} roster` : "You're on the roster"}
          </p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Your account is set up. An admin still needs to link it to your artist profile before
            your dates, casts and offers show up here. You'll get an email as soon as you're booked,
            so there's nothing you need to do right now.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
