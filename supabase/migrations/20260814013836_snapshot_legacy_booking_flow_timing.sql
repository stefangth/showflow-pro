-- Template timing is snapshot-based now: changing a platform template must not mutate
-- organizations that already exist. Preserve every legacy org's effective timing before
-- retiring the platform-wide timing editor. Existing org-owned values win; missing rows
-- receive the value they inherited from the old NULL-org platform row, or the canonical
-- code fallback when that row is absent/null.
insert into public.app_settings (org_id, key, value)
select
  o.id,
  timing.key,
  coalesce(nullif(platform.value, 'null'::jsonb), timing.fallback)
from public.organizations o
cross join (values
  ('offer_response_window_hours', '48'::jsonb),
  ('offer_digest_hour_berlin', '19'::jsonb),
  ('confirmation_digest_hour_berlin', '20'::jsonb)
) as timing(key, fallback)
left join public.app_settings platform
  on platform.org_id is null
 and platform.key = timing.key
on conflict (org_id, key) do nothing;
