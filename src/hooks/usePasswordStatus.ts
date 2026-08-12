import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchMyHasPassword } from "@/data/profiles";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const PASSWORD_STATUS_QUERY_KEY = ["auth", "has-password"] as const;

export function invalidatePasswordStatus(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: PASSWORD_STATUS_QUERY_KEY });
}

export function usePasswordStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...PASSWORD_STATUS_QUERY_KEY, user?.id],
    queryFn: () => fetchMyHasPassword(supabase),
    enabled: !!user?.id,
  });
}
