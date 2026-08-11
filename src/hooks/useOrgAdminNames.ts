import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgAdminNames } from "@/data/orgAdmins";

/**
 * The active org's admin display names, for surfaces that want to name a real person
 * instead of a nameless "an admin" (e.g. BookingProducerWaitingCard). Any member,
 * including a producer, may call the backing RPC; an empty array is normal (an admin
 * without a display name set yet).
 */
export function useOrgAdminNames(orgId: string | undefined) {
  return useQuery({
    queryKey: ["org-admins", "names", orgId],
    queryFn: () => fetchOrgAdminNames(supabase, orgId!),
    enabled: !!orgId,
  });
}
