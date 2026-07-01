import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPendingInvitedArtistIds } from "@/data/artists";

/** Artist ids in the org with a live pending app-login invite (drives the card chip). */
export function usePendingInvitedArtists(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["artists", "pending-invites", orgId],
    enabled: !!orgId,
    queryFn: () => fetchPendingInvitedArtistIds(supabase, orgId!),
  });
}
