-- Plan 3, Phase 1.6: capability-aware write RLS on show_assignments.
-- The old "Admins and producers can manage show_assignments" FOR ALL policy had
-- no separate SELECT policy, so gating the whole FOR ALL on the capability would
-- also gate producer READS — violating the read-only floor. Split it: admin FOR
-- ALL, producer SELECT (always), producer write gated on producer_can_manage_ownership.
drop policy "Admins and producers can manage show_assignments" on public.show_assignments;

create policy "Admins manage show_assignments" on public.show_assignments for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

create policy "Producers view show_assignments" on public.show_assignments for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'producer'));

create policy "Producers insert show_assignments" on public.show_assignments for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_manage_ownership')
  );

create policy "Producers update show_assignments" on public.show_assignments for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_manage_ownership')
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_manage_ownership')
  );

create policy "Producers delete show_assignments" on public.show_assignments for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_manage_ownership')
  );
