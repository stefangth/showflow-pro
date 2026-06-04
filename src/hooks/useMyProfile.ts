import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchMyProfile, updateMyProfile } from "@/data/profiles";

/** The signed-in user's profile row. */
export function useMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchMyProfile(supabase, user!.id),
  });
}

/** Update display name / phone, then refresh the profile query. */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (patch: { display_name?: string | null; phone?: string | null }) => {
      if (!user?.id) throw new Error("Not signed in");
      return updateMyProfile(supabase, user.id, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}
