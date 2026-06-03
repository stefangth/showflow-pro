import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/data/notifications';

export function useNotifications() {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: () => fetchNotifications(supabase, userId!),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(supabase, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      await markAllNotificationsRead(supabase, user.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}
