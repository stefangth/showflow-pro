-- Fix get_org_setting(): a JSONB-null-valued row (org or platform) must fall through
-- to the next tier instead of being treated as a "real" value. Previously a row
-- with value = 'null'::jsonb short-circuited resolution and returned null, even when
-- a usable platform default existed (or no row existed at all below it).
create or replace function public.get_org_setting(_org uuid, _key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings
  where key = _key and (org_id = _org or org_id is null)
    and value <> 'null'::jsonb
  order by (org_id is null)
  limit 1
$$;
