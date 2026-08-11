-- Server-side aggregate for the admin Skills catalog (Settings -> Casts & Cities):
-- fetchSkillCatalog previously issued 4 full-table reads (skills, artist_skills,
-- show_required_skills, show_date_required_skills) and counted client-side. This
-- RPC does the counting in the database instead, one call per catalog render.
--
-- SECURITY INVOKER (not DEFINER): the caller's own RLS still applies to every
-- underlying table, so this grants no more read access than the four queries it
-- replaces -- it just moves the aggregation server-side.
create or replace function public.skill_catalog(p_org uuid)
returns table (id uuid, name text, archived_at timestamptz,
               artist_count bigint, required_by_count bigint, required_by_date_count bigint)
language sql stable security invoker set search_path = public as $$
  select s.id, s.name, s.archived_at,
    (select count(*) from public.artist_skills a where a.skill_id = s.id),
    (select count(distinct r.show_id) from public.show_required_skills r where r.skill_id = s.id),
    (select count(distinct d.show_date_id) from public.show_date_required_skills d where d.skill_id = s.id)
  from public.skills s
  where s.org_id = p_org
  order by s.name;
$$;

grant execute on function public.skill_catalog(uuid) to authenticated;
