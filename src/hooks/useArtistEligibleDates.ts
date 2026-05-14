import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMyArtist } from './useMyArtist';
import { toDateKey } from '@/lib/dates';

export type EligibleDate = {
  id: string;                 // show_date.id
  date: string;               // YYYY-MM-DD
  start_time: string | null;
  end_time: string | null;
  status: string;
  city_id: string | null;
  show_id: string;
  show: {
    id: string;
    venue: string | null;
    program: string | null;
    sub_program: string | null;
    status: string;
  };
};

/**
 * Returns the set of upcoming `show_dates` an artist is eligible for, computed as:
 *
 *   artist
 *     └── cast_members (cast_ids)
 *           ├── show_cast_eligibility (city × show)  → matching show_dates
 *           └── show_date_cast_eligibility           → direct show_date overrides
 */
export function useArtistEligibleDates() {
  const { data: artist } = useMyArtist();

  return useQuery({
    queryKey: ['artist-eligible-dates', artist?.id],
    enabled: !!artist?.id,
    queryFn: async (): Promise<EligibleDate[]> => {
      // 1. Casts the artist belongs to
      const { data: memberships } = await supabase
        .from('cast_members')
        .select('cast_id')
        .eq('artist_id', artist!.id);
      const castIds = Array.from(new Set((memberships ?? []).map((m) => m.cast_id)));
      if (castIds.length === 0) return [];

      // 2a. Show+city eligibility for those casts
      const { data: showCity } = await supabase
        .from('show_cast_eligibility')
        .select('show_id, city_id')
        .in('cast_id', castIds);

      // 2b. Per-date overrides
      const { data: dateOverrides } = await supabase
        .from('show_date_cast_eligibility')
        .select('show_date_id')
        .in('cast_id', castIds);

      const overrideDateIds = new Set((dateOverrides ?? []).map((r) => r.show_date_id));

      // 3. Fetch all upcoming show_dates with their show
      const today = toDateKey(new Date());
      const { data: dates, error } = await supabase
        .from('show_dates')
        .select(
          'id, date, start_time, end_time, status, city_id, show_id, show:shows(id, venue, program, sub_program, status)'
        )
        .gte('date', today)
        .neq('status', 'cancelled')
        .order('date', { ascending: true });
      if (error) throw error;

      const showCityKey = new Set((showCity ?? []).map((r) => `${r.show_id}:${r.city_id}`));

      // 4. Filter to eligible
      const eligible = (dates ?? []).filter((d: any) => {
        if (overrideDateIds.has(d.id)) return true;
        if (d.city_id && showCityKey.has(`${d.show_id}:${d.city_id}`)) return true;
        return false;
      });

      return eligible as unknown as EligibleDate[];
    },
  });
}
