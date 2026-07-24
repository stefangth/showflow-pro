-- Plan 3, Phase 1.3: capability-aware write RLS on casts + cast_members.
-- Producer INSERT/UPDATE casts and INSERT/DELETE cast_members gated on
-- producer_can_manage_casts. casts DELETE stays admin-only (untouched).
-- SELECT policies untouched (read-only floor).
drop policy "Admins and producers can insert casts" on public.casts;
create policy "Admins and producers can insert casts" on public.casts for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_casts'))
  );

drop policy "Admins and producers can update casts" on public.casts;
create policy "Admins and producers can update casts" on public.casts for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_casts'))
  );

drop policy "Admins and producers can insert cast members" on public.cast_members;
create policy "Admins and producers can insert cast members" on public.cast_members for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_casts'))
  );

drop policy "Admins and producers can delete cast members" on public.cast_members;
create policy "Admins and producers can delete cast members" on public.cast_members for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_casts'))
  );
