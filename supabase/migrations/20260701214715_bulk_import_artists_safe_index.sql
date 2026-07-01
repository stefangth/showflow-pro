-- Spec B follow-up (review): a non-numeric 'index' in the payload previously aborted the
-- whole batch (the ::int cast throws). Iterate WITH ORDINALITY and guard the cast so a
-- malformed index falls back to the row's position instead of failing the entire import.
create or replace function public.bulk_import_artists(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_ord bigint;
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

  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'Too many rows (max 5000 per import)' using errcode = '22023';
  end if;

  for v_row, v_ord in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  loop
    v_index := case
      when (v_row->>'index') ~ '^-?[0-9]+$' then (v_row->>'index')::int
      else (v_ord - 1)::int
    end;
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
