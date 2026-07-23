create policy "Org admins manage unlocked capabilities"
  on public.org_capabilities for all to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    and not public.is_capability_locked(org_id, capability)
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    and not public.is_capability_locked(org_id, capability)
  );
