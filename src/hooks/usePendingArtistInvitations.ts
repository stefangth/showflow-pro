import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPendingArtistInvitations } from "@/data/invitations";

/**
 * Pending artist-role invitations for the org, keyed for the Artists-page revoke/resend
 * controls. Only rows with a non-null artistId are actionable from an artist card.
 */
export function usePendingArtistInvitations(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["artists", "pending-invitations", orgId],
    enabled: !!orgId,
    queryFn: () => fetchPendingArtistInvitations(supabase, orgId!),
  });
}
