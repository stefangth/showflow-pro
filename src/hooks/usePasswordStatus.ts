import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { changeMyPassword, fetchMyHasPassword, setMyPassword } from "@/data/profiles";
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

export function useSetMyPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => setMyPassword(supabase, password),
    onSuccess: () => invalidatePasswordStatus(queryClient),
  });
}

export function useChangeMyPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { password: string; currentPassword?: string; nonce?: string }) => changeMyPassword(supabase, args),
    onSuccess: () => invalidatePasswordStatus(queryClient),
  });
}
