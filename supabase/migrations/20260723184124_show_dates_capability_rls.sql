-- Plan 3, Phase 1.2: capability-aware write RLS on show_dates.
-- Producer INSERT/UPDATE gated on producer_can_manage_show_dates; producer
-- DELETE gated on producer_can_hard_delete_show_dates. Admin always allowed.
-- SELECT ("Authenticated can view show_dates") untouched (read-only floor).
drop policy "Admins and producers can manage show_dates" on public.show_dates;
create policy "Admins and producers can manage show_dates" on public.show_dates for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_show_dates'))
  );

drop policy "Admins and producers can update show_dates" on public.show_dates;
create policy "Admins and producers can update show_dates" on public.show_dates for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_show_dates'))
  );

drop policy "Admins can delete show_dates" on public.show_dates;
create policy "Admins can delete show_dates" on public.show_dates for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_hard_delete_show_dates'))
  );
