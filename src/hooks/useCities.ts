import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchCitiesForLinking, type CityLink } from "@/data/cities";

export type { CityLink };

export function useCities() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["cities", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCitiesForLinking(supabase, currentOrg?.id ?? null),
  });
}
