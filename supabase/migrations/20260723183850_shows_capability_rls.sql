-- Plan 3, Phase 1.1: capability-aware write RLS on shows.
-- Producer INSERT/UPDATE gated on producer_can_manage_productions; producer
-- DELETE gated on producer_can_hard_delete_productions. Admin always allowed.
-- SELECT policy ("Authenticated can view shows") is untouched (read-only floor).
drop policy "Admins and producers can create shows" on public.shows;
create policy "Admins and producers can create shows" on public.shows for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_productions'))
  );

drop policy "Admins and producers can update shows" on public.shows;
create policy "Admins and producers can update shows" on public.shows for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_productions'))
  );

drop policy "Admins can delete shows" on public.shows;
create policy "Admins can delete shows" on public.shows for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_hard_delete_productions'))
  );
