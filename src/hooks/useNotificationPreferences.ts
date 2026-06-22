import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  fetchMyNotificationPreferences,
  updateMyNotificationPreferences,
  type NotificationPrefs,
} from "@/data/notificationPreferences";

export function useNotificationPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notification-preferences", user?.id],
    queryFn: () => fetchMyNotificationPreferences(supabase, user!.id),
    enabled: !!user?.id,
  });
}

export function useUpdateNotificationPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) => {
      if (!user?.id) throw new Error("Not signed in");
      return updateMyNotificationPreferences(supabase, user.id, prefs);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
