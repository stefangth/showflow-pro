import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { computeSchedulingWarnings, type SettingsWarnings } from '@/lib/settings';
import { fetchShowsWithSlots } from '@/data/settings';

export type { SettingsWarnings };

export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole, currentOrg } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');
  const orgId = currentOrg?.id ?? null;

  const { data: shows } = useQuery({
    queryKey: ['shows', 'with-slots', orgId],
    enabled: canView,
    queryFn: () => fetchShowsWithSlots(supabase, orgId),
    staleTime: 30_000,
  });

  return computeSchedulingWarnings(shows);
}
