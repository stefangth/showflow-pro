import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMyArtist } from './useMyArtist';
import { toDateKey } from '@/lib/dates';
import { artistHasAllSkills } from '@/lib/eligibility';

export type EligibleDate = {
  id: string;                 // show_date.id
  date: string;               // YYYY-MM-DD
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  status: string;
  city_id: string | null;
  show_id: string;
  venue: string | null;
  custom: Record<string, unknown> | null;
  show: {
    id: string;
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
          'id, date, session_1, session_2, session_3, status, city_id, show_id, venue, custom, show:shows(id, program, sub_program, status)'
        )
        .gte('date', today)
        .neq('status', 'cancelled')
        .order('date', { ascending: true });
      if (error) throw error;

      interface EligibleDateRow {
        id: string; date: string;
        session_1: string | null; session_2: string | null; session_3: string | null;
        status: string; city_id: string | null; show_id: string;
        venue: string | null; custom: Record<string, unknown> | null;
        show: { id: string; program: string | null; sub_program: string | null; status: string } | null;
      }
      const allDates = (dates ?? []) as unknown as EligibleDateRow[];

      const showCityKey = new Set((showCity ?? []).map((r) => `${r.show_id}:${r.city_id}`));

      // 4. Filter to eligible
      const eligible = allDates.filter((d) => {
        if (overrideDateIds.has(d.id)) return true;
        if (d.city_id && showCityKey.has(`${d.show_id}:${d.city_id}`)) return true;
        return false;
      });

      // 5. Hard skill requirements: the artist only sees dates whose required
      // skills (show-level union date-level) they fully hold (phase 4 spec).
      if (eligible.length === 0) return [];

      const { data: mySkills } = await supabase
        .from('artist_skills')
        .select('skill_id')
        .eq('artist_id', artist!.id);
      const mySkillIds = new Set((mySkills ?? []).map((r) => r.skill_id));

      const showIds = Array.from(new Set(eligible.map((d) => d.show_id)));
      const dateIds = eligible.map((d) => d.id);
      const { data: showReq } = await supabase
        .from('show_required_skills')
        .select('show_id, skill_id')
        .in('show_id', showIds);
      const { data: dateReq } = await supabase
        .from('show_date_required_skills')
        .select('show_date_id, skill_id')
        .in('show_date_id', dateIds);

      const requiredByShow = new Map<string, string[]>();
      for (const r of showReq ?? []) {
        requiredByShow.set(r.show_id, [...(requiredByShow.get(r.show_id) ?? []), r.skill_id]);
      }
      const requiredByDate = new Map<string, string[]>();
      for (const r of dateReq ?? []) {
        requiredByDate.set(r.show_date_id, [...(requiredByDate.get(r.show_date_id) ?? []), r.skill_id]);
      }

      const qualified = eligible.filter((d) => {
        const required = [
          ...(requiredByShow.get(d.show_id) ?? []),
          ...(requiredByDate.get(d.id) ?? []),
        ];
        return artistHasAllSkills(mySkillIds, required);
      });

      return qualified as unknown as EligibleDate[];
    },
  });
}
