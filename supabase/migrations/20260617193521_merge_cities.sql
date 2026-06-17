-- merge_cities: collapse duplicate city rows into one survivor, repointing every city_id FK
-- (with per-table unique-conflict handling) before deleting the losers. Admin-only, transactional.
-- FKs to cities.id: show_dates.city_id (SET NULL), show_assignments.city_id (SET NULL),
-- cast_city_priority.city_id (CASCADE), show_cast_eligibility.city_id (CASCADE).
-- Per table: UPDATE only loser rows that would NOT collide (vs a survivor row or an earlier-id
-- loser row) on that table's unique key(s); DELETE the rest. Survivor's own rows always win.
create or replace function public.merge_cities(p_survivor uuid, p_losers uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_found int;
begin
  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_cities: no loser cities provided';
  end if;
  if p_survivor = any(p_losers) then
    raise exception 'merge_cities: survivor cannot be in the loser set' using errcode = '22023';
  end if;

  select org_id into v_org from cities where id = p_survivor;
  if v_org is null then
    raise exception 'merge_cities: survivor city % not found', p_survivor using errcode = 'P0002';
  end if;

  if not has_org_role(auth.uid(), v_org, 'admin') then
    raise exception 'merge_cities: not authorized' using errcode = '42501';
  end if;

  select count(*) into v_found from cities where id = any(p_losers);
  if v_found <> array_length(p_losers, 1) then
    raise exception 'merge_cities: one or more loser cities not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from cities where id = any(p_losers) and org_id is distinct from v_org) then
    raise exception 'merge_cities: loser cities must belong to the survivor''s org' using errcode = '42501';
  end if;

  -- show_dates: no unique involving city_id -> plain repoint (preserve date<->city association)
  update show_dates set city_id = p_survivor where city_id = any(p_losers);

  -- show_assignments: unique (producer_user_id, program, sub_program, city_id) NULLS NOT DISTINCT
  update show_assignments a set city_id = p_survivor
   where a.city_id = any(p_losers)
     and not exists (select 1 from show_assignments s
       where s.city_id = p_survivor
         and s.producer_user_id is not distinct from a.producer_user_id
         and s.program          is not distinct from a.program
         and s.sub_program      is not distinct from a.sub_program)
     and not exists (select 1 from show_assignments a2
       where a2.city_id = any(p_losers) and a2.id < a.id
         and a2.producer_user_id is not distinct from a.producer_user_id
         and a2.program          is not distinct from a.program
         and a2.sub_program      is not distinct from a.sub_program);
  delete from show_assignments where city_id = any(p_losers);

  -- cast_city_priority: TWO uniques -- (cast_id, city_id) AND (city_id, priority)
  update cast_city_priority p set city_id = p_survivor
   where p.city_id = any(p_losers)
     and not exists (select 1 from cast_city_priority s
       where s.city_id = p_survivor and (s.cast_id = p.cast_id or s.priority = p.priority))
     and not exists (select 1 from cast_city_priority p2
       where p2.city_id = any(p_losers) and p2.id < p.id
         and (p2.cast_id = p.cast_id or p2.priority = p.priority));
  delete from cast_city_priority where city_id = any(p_losers);

  -- show_cast_eligibility: unique (show_id, city_id, cast_id)
  update show_cast_eligibility e set city_id = p_survivor
   where e.city_id = any(p_losers)
     and not exists (select 1 from show_cast_eligibility s
       where s.city_id = p_survivor and s.show_id = e.show_id and s.cast_id = e.cast_id)
     and not exists (select 1 from show_cast_eligibility e2
       where e2.city_id = any(p_losers) and e2.id < e.id
         and e2.show_id = e.show_id and e2.cast_id = e.cast_id);
  delete from show_cast_eligibility where city_id = any(p_losers);

  delete from cities where id = any(p_losers);
end;
$fn$;

revoke all on function public.merge_cities(uuid, uuid[]) from public;
grant execute on function public.merge_cities(uuid, uuid[]) to authenticated;

-- One-time normalization: lowercase any city keys written by the old case-preserving buildCityKey
-- so the now-case-insensitive resolution keeps matching them. No-op in prod today (0 linked cities)
-- but closes the window where a city linked on old code wouldn't resolve.
update public.cities set airtable_city_key = lower(btrim(airtable_city_key))
 where airtable_city_key is not null and airtable_city_key <> lower(btrim(airtable_city_key));
