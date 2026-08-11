import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchOrgDataStats } from "@/data/trustStats";

/** What the active organisation holds — the counts behind Settings > Trust & data. */
export function useOrgDataStats() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["trust", "org-stats", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchOrgDataStats(supabase, currentOrg!.id),
  });
}
