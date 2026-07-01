-- Spec B: producer/admin-guarded bulk artist insert with server-side dedup. Runs in
-- one transaction (atomic); returns a per-row jsonb status array. SECURITY DEFINER so
-- producers can bulk-insert without loosening the admin-only single-insert table RLS;
-- the role gate is re-checked here. Dedup is lower(email) within p_org and, because
-- earlier inserts are visible to later iterations, intra-file duplicates are skipped too.
create or replace function public.bulk_import_artists(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_index int;
  v_name text;
  v_email text;
  v_phone text;
  v_bio text;
  v_new_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if not (public.has_org_role(v_uid, p_org, 'producer')
          or public.has_org_role(v_uid, p_org, 'admin')) then
    raise exception 'Forbidden: producer or admin only' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_index := coalesce((v_row->>'index')::int, 0);
    v_name  := nullif(btrim(coalesce(v_row->>'name', '')), '');
    v_email := nullif(btrim(coalesce(v_row->>'email', '')), '');
    v_phone := nullif(btrim(coalesce(v_row->>'phone', '')), '');
    v_bio   := nullif(btrim(coalesce(v_row->>'bio', '')), '');

    if v_name is null then
      v_results := v_results || jsonb_build_object('index', v_index, 'status', 'error', 'error', 'Name is required');
      continue;
    end if;

    if v_email is not null and exists (
      select 1 from public.artists a
      where a.org_id = p_org and lower(a.email) = lower(v_email)
    ) then
      v_results := v_results || jsonb_build_object('index', v_index, 'status', 'skipped_existing');
      continue;
    end if;

    insert into public.artists (name, email, phone, bio, org_id, status)
    values (v_name, v_email, v_phone, v_bio, p_org, 'active')
    returning id into v_new_id;

    v_results := v_results || jsonb_build_object('index', v_index, 'status', 'created', 'artist_id', v_new_id);
  end loop;

  return v_results;
end;
$$;

revoke all on function public.bulk_import_artists(uuid, jsonb) from public, anon;
grant execute on function public.bulk_import_artists(uuid, jsonb) to authenticated;
