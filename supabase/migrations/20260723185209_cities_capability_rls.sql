-- Plan 3, Phase 1.5: capability-aware write RLS on cities + cast_city_priority.
-- Producer INSERT/UPDATE cities and INSERT/UPDATE/DELETE cast_city_priority
-- gated on producer_can_manage_cities. cities DELETE stays admin-only.
-- SELECT policies untouched (read-only floor).
drop policy "Admins and producers can insert cities" on public.cities;
create policy "Admins and producers can insert cities" on public.cities for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_cities'))
  );

drop policy "Admins and producers can update cities" on public.cities;
create policy "Admins and producers can update cities" on public.cities for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_cities'))
  );

drop policy "Admins and producers can insert cast_city_priority" on public.cast_city_priority;
create policy "Admins and producers can insert cast_city_priority" on public.cast_city_priority for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_cities'))
  );

drop policy "Admins and producers can update cast_city_priority" on public.cast_city_priority;
create policy "Admins and producers can update cast_city_priority" on public.cast_city_priority for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_cities'))
  );

drop policy "Admins and producers can delete cast_city_priority" on public.cast_city_priority;
create policy "Admins and producers can delete cast_city_priority" on public.cast_city_priority for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_cities'))
  );
