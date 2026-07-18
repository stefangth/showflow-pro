import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';

/**
 * Returns whether the current user is allowed to read/post in the chat for a given show date.
 * Producers + admins always pass; artists must have a soft_booked or confirmed booking.
 */
export function useChatParticipant(showDateId: string | null | undefined) {
  const { user, hasRole } = useAuth();
  const elevated = hasRole('admin') || hasRole('producer');

  return useQuery({
    queryKey: ['chat-participant', showDateId, user?.id, elevated],
    enabled: !!showDateId && !!user,
    queryFn: async () => {
      if (elevated) return true;
      const { data, error } = await supabase
        .from('bookings')
        .select('id, artist:artists!inner(user_id)')
        .eq('show_date_id', showDateId!)
        .in('status', ['soft_booked', 'confirmed']);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { artist: { user_id: string | null } | null }[];
      return rows.some((b) => b.artist?.user_id === user!.id);
    },
  });
}
