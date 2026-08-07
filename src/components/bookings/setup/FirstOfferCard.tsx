import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { fetchMyOpenOffersCount } from "@/data/bookings";
import { DEFAULT_FLOW_TIMES } from "@/data/settings";
import { inPracticeRows, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

/** A one-time explainer shown to an artist while they have a pending offer. The body is
 *  the Artist row of `inPracticeRows`, so it stays true under every preset. Dismissible
 *  per browser. */
export function FirstOfferCard() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist } = useMyArtist();
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const [dismissed, dismiss] = useRailDismissed("artistFirstOffer", orgId);

  const offers = useQuery({
    queryKey: ["bookings", "my-open-offers", artist?.id],
    enabled: !!artist?.id,
    queryFn: () => fetchMyOpenOffersCount(supabase, artist!.id),
  });

  if (dismissed) return null;
  if (!offers.data || offers.data < 1) return null;

  const t = times ?? DEFAULT_FLOW_TIMES;
  const artistRow = inPracticeRows(flow ?? BOOKING_FLOW_DEFAULTS, t).find((r) => r.who === "Artist");

  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-accent-700">Your first offer</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{artistRow?.text}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-auto shrink-0 p-1" onClick={dismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
