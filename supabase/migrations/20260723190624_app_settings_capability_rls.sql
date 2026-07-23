-- Plan 3, Phase 1.8: capability-aware write RLS on app_settings.
-- Preserves the exact admin write path (first disjunct, identical to the old
-- admin-only policies — so super-admin / platform (null-org) settings writes are
-- unchanged) and ADDS a producer arm: a producer may write a setting only when
-- app_setting_capability(key) resolves to a capability that is enabled for the org.
-- Unmapped keys (app_setting_capability -> null) stay admin-only (fail-safe).
-- SELECT ("Authenticated users can view app settings") is untouched (read-only floor).
drop policy "Admins can insert app settings" on public.app_settings;
create policy "Members write app settings by capability" on public.app_settings for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.app_setting_capability(key) is not null
        and public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, public.app_setting_capability(key)))
  );

drop policy "Admins can update app settings" on public.app_settings;
create policy "Members update app settings by capability" on public.app_settings for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.app_setting_capability(key) is not null
        and public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, public.app_setting_capability(key)))
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.app_setting_capability(key) is not null
        and public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, public.app_setting_capability(key)))
  );

drop policy "Admins can delete app settings" on public.app_settings;
create policy "Members delete app settings by capability" on public.app_settings for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.app_setting_capability(key) is not null
        and public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, public.app_setting_capability(key)))
  );
