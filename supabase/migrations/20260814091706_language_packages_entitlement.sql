-- Teach is_feature_enabled() about the language_packages module (ships dark).
-- Mirrors src/lib/entitlements.ts FEATURE_REGISTRY (defaultEnabled: false).
-- Verbatim copy of the body from 20260716233515_org_entitlements.sql with the
-- single addition of the 'language_packages' branch (also default false, but
-- explicit rather than falling through the `else false` by coincidence).
create or replace function public.is_feature_enabled(_org uuid, _feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select enabled from public.org_entitlements where org_id = _org and feature = _feature),
    case _feature
      when 'booking_flow' then true
      when 'hire_orders'  then false
      when 'language_packages' then false
      else false
    end
  );
$$;
