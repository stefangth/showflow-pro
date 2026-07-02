import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchCities } from "@/data/cities";

/**
 * Full-row, org-filtered cities for admin/booking surfaces. Distinct query key
 * (`['cities','all', orgId]`) from the narrow linking projection (`useCities` →
 * `['cities','link', orgId]`) so the two projections never clobber each other's
 * cache slot. The `['cities']` prefix invalidation in city mutations catches both.
 */
export function useAllCities(enabled = true) {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["cities", "all", currentOrg?.id],
    enabled: enabled && !!currentOrg,
    queryFn: () => fetchCities(supabase, currentOrg?.id ?? null),
  });
}
