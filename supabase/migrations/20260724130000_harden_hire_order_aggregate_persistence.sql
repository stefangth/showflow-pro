-- Final persistence hardening for aggregate hire orders.
--
-- Delivery timestamps are server-owned, issued schedule rows are immutable,
-- and aggregate parent/child creation is one database statement so a child
-- failure cannot strand a parent row.

create or replace function public.protect_hire_order_last_sent_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    (tg_op = 'INSERT' and new.last_sent_at is not null)
    or (
      tg_op = 'UPDATE'
      and new.last_sent_at is distinct from old.last_sent_at
    )
  ) and current_user <> 'service_role' then
    raise exception 'last_sent_at is managed by the delivery service'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_hire_order_last_sent_at
  before insert or update of last_sent_at on public.hire_orders
  for each row execute function public.protect_hire_order_last_sent_at();

-- New Supabase projects no longer necessarily grant Data API roles access to
-- newly-created relations. Keep the trusted edge delivery write explicit and
-- column-scoped.
grant select on public.hire_orders to service_role;
grant update (last_sent_at) on public.hire_orders to service_role;
grant select on public.hire_order_dates to service_role;

create or replace function public.enforce_hire_order_date_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_parent_ids := array[new.hire_order_id];
  elsif tg_op = 'DELETE' then
    v_parent_ids := array[old.hire_order_id];
  else
    v_parent_ids := array[old.hire_order_id, new.hire_order_id];
  end if;

  if exists (
    select 1
    from public.hire_orders ho
    where ho.id = any(v_parent_ids)
      and ho.status in ('issued', 'countersigned')
  ) then
    raise exception 'issued hire order dates are immutable';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger enforce_hire_order_date_immutability
  before insert or update or delete on public.hire_order_dates
  for each row execute function public.enforce_hire_order_date_immutability();

create or replace function public.create_hire_order_with_dates(
  p_org uuid,
  p_order_no text,
  p_artist uuid,
  p_show_date_ids uuid[],
  p_data jsonb,
  p_fee_amount numeric,
  p_fee_currency text,
  p_terms_variant text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hire_order_id uuid;
  v_first_show_date_id uuid;
begin
  if p_org is null or not exists (
    select 1
    from public.organizations organization
    where organization.id = p_org
  ) then
    raise exception 'organization does not exist' using errcode = '22023';
  end if;

  if p_artist is null or not exists (
    select 1
    from public.artists artist
    where artist.id = p_artist
      and artist.org_id = p_org
  ) then
    raise exception 'artist belongs to a different org' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_show_date_ids), 0) = 0 then
    raise exception 'at least one show date is required' using errcode = '22023';
  end if;

  if array_position(p_show_date_ids, null) is not null then
    raise exception 'show date id cannot be null' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct requested.show_date_id)
    from unnest(p_show_date_ids) requested(show_date_id)
  ) then
    raise exception 'show date ids must be unique' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_show_date_ids) requested(show_date_id)
    left join public.show_dates show_date
      on show_date.id = requested.show_date_id
    where show_date.id is null
      or show_date.org_id is distinct from p_org
  ) then
    raise exception 'show date belongs to a different org' using errcode = '22023';
  end if;

  if nullif(btrim(p_order_no), '') is null then
    raise exception 'order number is required' using errcode = '22023';
  end if;

  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'hire order data must be an object' using errcode = '22023';
  end if;

  -- This helper obtains the artist-scoped transaction advisory lock and checks
  -- both legacy hire_orders.show_date_id and aggregate child rows. The lock is
  -- retained until this function's surrounding transaction finishes.
  perform public.assert_hire_order_dates_available(
    p_org,
    p_artist,
    p_show_date_ids
  );

  -- Single-date orders retain the legacy direct relation. Multi-date aggregate
  -- parents derive their complete schedule exclusively from ordered children.
  v_first_show_date_id := case
    when cardinality(p_show_date_ids) = 1
      then p_show_date_ids[array_lower(p_show_date_ids, 1)]
    else null
  end;

  insert into public.hire_orders (
    org_id,
    order_no,
    status,
    booking_id,
    artist_id,
    show_date_id,
    data,
    fee_amount,
    fee_currency,
    terms_variant,
    created_by
  )
  values (
    p_org,
    p_order_no,
    'draft',
    null,
    p_artist,
    v_first_show_date_id,
    p_data,
    p_fee_amount,
    p_fee_currency,
    p_terms_variant,
    p_created_by
  )
  returning id into v_hire_order_id;

  insert into public.hire_order_dates (
    hire_order_id,
    show_date_id,
    org_id,
    position
  )
  select
    v_hire_order_id,
    requested.show_date_id,
    p_org,
    (requested.ordinality - 1)::smallint
  from unnest(p_show_date_ids) with ordinality
    as requested(show_date_id, ordinality)
  order by requested.ordinality;

  return v_hire_order_id;
end;
$$;

revoke all on function public.create_hire_order_with_dates(
  uuid,
  text,
  uuid,
  uuid[],
  jsonb,
  numeric,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_hire_order_with_dates(
  uuid,
  text,
  uuid,
  uuid[],
  jsonb,
  numeric,
  text,
  text,
  uuid
) to service_role;
