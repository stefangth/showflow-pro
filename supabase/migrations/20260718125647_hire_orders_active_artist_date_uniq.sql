-- One active (non-void) hire order per (org, artist, show_date) for LINKED
-- orders, mirroring bookings_active_artist_date_uniq (20260616161112): the
-- bulk_import_hire_orders RPC's dedup was a racy SELECT EXISTS + INSERT with
-- no backing constraint, so a concurrent import (or the fully_filled
-- auto-draft trigger racing an import) could pass the pre-check twice and
-- create two active orders for the same (artist, show_date). Partial on
-- artist_id/show_date_id IS NOT NULL because unlinked (manual/wizard) orders
-- are intentionally never deduped -- see the bulk_import_hire_orders RPC
-- comment and draftManual in generate-hire-orders. Partial on status <>
-- 'void' so a voided order never blocks a fresh one for the same pair.
create unique index if not exists hire_orders_active_artist_date_uniq
  on public.hire_orders (org_id, artist_id, show_date_id)
  where status <> 'void' and artist_id is not null and show_date_id is not null;

-- bulk_import_hire_orders: constraint-name discrimination on unique_violation
-- (CREATE OR REPLACE of the 20260718005949 function). Two distinct unique
-- constraints can now raise 23505 on the per-row insert:
--   hire_orders_org_id_order_no_key (order_no collision) -> unchanged: keep
--     retrying the collision suffix (attempts 0..19).
--   hire_orders_active_artist_date_uniq (the backstop index above) -> NOT
--     retriable by suffix -- a different order_no can never resolve an
--     artist/date conflict -- so record 'skipped_existing' (the same status
--     the pre-check SELECT EXISTS already produces for the non-racy case)
--     and move on to the next row instead of burning through 20 attempts.
-- Discriminated via `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`, which
-- Postgres populates from the failing unique INDEX's name even when that
-- index isn't a table-level CONSTRAINT (verified live: a plain partial
-- unique index raises unique_violation with CONSTRAINT_NAME = the index
-- name, exactly like a `UNIQUE (...)` column constraint does).
create or replace function public.bulk_import_hire_orders(p_org uuid, p_import jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_import_id uuid;
  v_numbering jsonb;
  v_prefix text;
  v_pattern text;

  v_row jsonb;
  v_ord bigint;
  v_index int;
  v_artist_id uuid;
  v_show_date_id uuid;
  v_data jsonb;
  v_fee_amount numeric;
  v_fee_currency text;
  v_terms_variant text;

  v_iso_date text;
  v_yyyy text;
  v_mm text;
  v_dd text;
  v_mmdd text;
  v_cast_code text;
  v_seq int;
  v_base_order_no text;
  v_order_no text;
  v_new_id uuid;
  v_attempt int;
  v_constraint text;

  v_results jsonb := '[]'::jsonb;
begin
  if not (public.has_org_role(v_uid, p_org, 'producer')
          or public.has_org_role(v_uid, p_org, 'admin')) then
    raise exception 'Forbidden: producer or admin only' using errcode = '42501';
  end if;

  if not public.is_feature_enabled(p_org, 'hire_orders') then
    raise exception 'hire_orders feature not enabled' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'Too many rows (max 5000 per import)' using errcode = '22023';
  end if;

  -- Numbering settings: org override else platform default else the hardcoded
  -- fallback (mirrors NUMBERING_DEFAULT in generate-hire-orders/index.ts).
  v_numbering := public.get_org_setting(p_org, 'hire_order_numbering');
  v_prefix := coalesce(v_numbering->>'prefix', 'HO');
  v_pattern := coalesce(v_numbering->>'pattern', '{prefix}-{yyyy}-{mmdd}-{seq}');

  insert into public.hire_order_imports (org_id, source, file_name, mapping, row_count, created_by)
  values (
    p_org,
    p_import->>'source',
    p_import->>'file_name',
    coalesce(p_import->'mapping', '{}'::jsonb),
    coalesce(
      case when (p_import->>'row_count') ~ '^[0-9]+$' then (p_import->>'row_count')::int end,
      jsonb_array_length(coalesce(p_rows, '[]'::jsonb))
    ),
    v_uid
  )
  returning id into v_import_id;

  <<row_loop>>
  for v_row, v_ord in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  loop
    begin
      v_index := case
        when (v_row->>'row_index') ~ '^-?[0-9]+$' then (v_row->>'row_index')::int
        else (v_ord - 1)::int
      end;

      v_artist_id := nullif(v_row->>'artist_id', '')::uuid;
      v_show_date_id := nullif(v_row->>'show_date_id', '')::uuid;
      v_data := coalesce(v_row->'data', '{}'::jsonb);
      v_fee_currency := coalesce(nullif(v_row->>'fee_currency', ''), 'EUR');
      v_terms_variant := coalesce(nullif(v_row->>'terms_variant', ''), 'standard');

      -- fee_amount: explicit row.fee_amount wins; else derive from
      -- data.fee.value when it looks numeric; else null.
      v_fee_amount := null;
      if jsonb_typeof(v_row->'fee_amount') = 'number' then
        v_fee_amount := (v_row->>'fee_amount')::numeric;
      elsif jsonb_typeof(v_row->'fee_amount') = 'string'
            and (v_row->>'fee_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_fee_amount := (v_row->>'fee_amount')::numeric;
      end if;
      if v_fee_amount is null and (v_data->'fee'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_fee_amount := (v_data->'fee'->>'value')::numeric;
      end if;

      -- Fast-path duplicate detection (pre-check): only when BOTH links are
      -- present. This is a correctness OPTIMIZATION, not the guarantee --
      -- hire_orders_active_artist_date_uniq above is the race-safe backstop
      -- exercised in the insert's exception handler below.
      if v_artist_id is not null and v_show_date_id is not null and exists (
        select 1 from public.hire_orders
        where org_id = p_org and status <> 'void'
          and artist_id = v_artist_id and show_date_id = v_show_date_id
      ) then
        v_results := v_results || jsonb_build_object('row_index', v_index, 'status', 'skipped_existing');
        continue;
      end if;

      -- Order number: derive yyyy/mm/dd by SLICING the ISO date string (no
      -- Date parsing -- see src/lib/dates.ts for why). seq = 1 + count of
      -- non-void hire_orders for this org sharing the same date (earlier
      -- inserts in this loop are already visible, so seq auto-advances
      -- across rows sharing a date); rows with no date fall back to a
      -- simple org-wide non-void count.
      v_iso_date := v_data->'date'->>'value';
      if v_iso_date is not null and v_iso_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
        v_yyyy := substr(v_iso_date, 1, 4);
        v_mm := substr(v_iso_date, 6, 2);
        v_dd := substr(v_iso_date, 9, 2);
        v_mmdd := v_mm || v_dd;
        select count(*) into v_seq from public.hire_orders
          where org_id = p_org and status <> 'void' and data->'date'->>'value' = v_iso_date;
      else
        v_yyyy := '';
        v_mm := '';
        v_dd := '';
        v_mmdd := '';
        select count(*) into v_seq from public.hire_orders
          where org_id = p_org and status <> 'void';
      end if;
      v_seq := coalesce(v_seq, 0) + 1;

      v_cast_code := v_data->'cast'->>'value';

      v_base_order_no := v_pattern;
      v_base_order_no := replace(v_base_order_no, '{prefix}', v_prefix);
      v_base_order_no := replace(v_base_order_no, '{yyyy}', v_yyyy);
      v_base_order_no := replace(v_base_order_no, '{mmdd}', v_mmdd);
      v_base_order_no := replace(v_base_order_no, '{mm}', v_mm);
      v_base_order_no := replace(v_base_order_no, '{dd}', v_dd);
      -- {cast|seq} must be replaced before the standalone {cast}/{seq} tokens.
      v_base_order_no := replace(v_base_order_no, '{cast|seq}', coalesce(v_cast_code, v_seq::text));
      v_base_order_no := replace(v_base_order_no, '{cast}', coalesce(v_cast_code, ''));
      v_base_order_no := replace(v_base_order_no, '{seq}', v_seq::text);

      -- Insert with a unique_violation collision-suffix retry (mirrors
      -- withCollisionSuffix: attempt 0 -> base, 1 -> "-2", 2 -> "-3", ...).
      -- On unique_violation, distinguish WHICH constraint fired: an
      -- order_no collision keeps retrying the suffix; a hit on the
      -- active-artist-date backstop is a genuine duplicate that no suffix
      -- can resolve, so it is recorded as skipped_existing and the row loop
      -- moves on (via the row_loop label -- this insert is nested two
      -- levels deep, inside the attempt loop AND the per-row begin block).
      v_new_id := null;
      for v_attempt in 0..19 loop
        v_order_no := case when v_attempt = 0 then v_base_order_no
                            else v_base_order_no || '-' || (v_attempt + 1)::text end;
        begin
          insert into public.hire_orders (
            org_id, order_no, status, booking_id, artist_id, show_date_id, data,
            fee_amount, fee_currency, terms_variant, import_id, created_by
          ) values (
            p_org, v_order_no, 'draft', null, v_artist_id, v_show_date_id, v_data,
            v_fee_amount, v_fee_currency, v_terms_variant, v_import_id, v_uid
          )
          returning id into v_new_id;
          exit;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint = 'hire_orders_active_artist_date_uniq' then
            v_results := v_results || jsonb_build_object('row_index', v_index, 'status', 'skipped_existing');
            continue row_loop;
          end if;
          v_new_id := null;
        end;
      end loop;

      if v_new_id is null then
        v_results := v_results || jsonb_build_object('row_index', v_index, 'status', 'error', 'error', 'order_no_collision');
        continue;
      end if;

      v_results := v_results || jsonb_build_object('row_index', v_index, 'status', 'created', 'order_id', v_new_id);
    exception when others then
      v_results := v_results || jsonb_build_object(
        'row_index', coalesce(v_index, (v_ord - 1)::int),
        'status', 'error',
        'error', sqlerrm
      );
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.bulk_import_hire_orders(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.bulk_import_hire_orders(uuid, jsonb, jsonb) to authenticated;
