import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { resolveOrgSetting } from '@/data/settings';

export type FilterPage = 'shows' | 'artists' | 'bookings';
export type FilterKey = 'program' | 'timeframe' | 'sort' | 'status';

type Visibility = Record<FilterPage, Record<'producer' | 'artist', Record<FilterKey, boolean>>>;

const FALLBACK: Visibility = {
  shows: { producer: { program: true, timeframe: true, sort: true, status: true }, artist: { program: true, timeframe: true, sort: true, status: false } },
  artists: { producer: { program: true, timeframe: true, sort: true, status: true }, artist: { program: false, timeframe: false, sort: true, status: false } },
  bookings: { producer: { program: true, timeframe: true, sort: true, status: true }, artist: { program: true, timeframe: true, sort: true, status: true } },
};

export function useFilterVisibility(page: FilterPage) {
  const { hasRole, currentOrg } = useAuth();
  const isAdmin = hasRole('admin');
  const role: 'producer' | 'artist' = hasRole('producer') ? 'producer' : 'artist';
  const orgId = currentOrg?.id ?? null;

  const { data } = useQuery({
    queryKey: ['app-settings', 'filters_visibility', orgId],
    queryFn: () => resolveOrgSetting(supabase, orgId, 'filters_visibility', FALLBACK as Visibility),
    staleTime: 60_000,
  });

  const v = data ?? FALLBACK;
  const canSee = (key: FilterKey) => isAdmin || (v[page]?.[role]?.[key] ?? true);
  return { canSee, isAdmin };
}
