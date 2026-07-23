alter table public.hire_orders add column last_sent_at timestamptz;

create table public.hire_order_dates (
  hire_order_id uuid not null references public.hire_orders(id) on delete cascade,
  show_date_id uuid not null references public.show_dates(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete cascade,
  position smallint not null check (position >= 0),
  primary key (hire_order_id, show_date_id),
  unique (hire_order_id, position)
);

create index hire_order_dates_show_date_idx
  on public.hire_order_dates (show_date_id, hire_order_id);

create or replace function public.enforce_hire_order_date_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_org uuid;
  v_show_date_org uuid;
begin
  -- Lock the parent before resolving its identity. Parent artist/org/status
  -- updates take the same row lock, so a child can never validate against an
  -- identity that changes before the overlap trigger runs.
  select org_id
    into v_parent_org
  from public.hire_orders
  where id = new.hire_order_id
  for update;

  select org_id
    into v_show_date_org
  from public.show_dates
  where id = new.show_date_id;

  if v_parent_org is distinct from new.org_id
     or v_show_date_org is distinct from new.org_id then
    raise exception 'hire order date belongs to a different org';
  end if;
  return new;
end $$;

create trigger enforce_hire_order_date_org before insert or update on public.hire_order_dates
  for each row execute function public.enforce_hire_order_date_org();

create or replace function public.assert_hire_order_dates_available(
  p_org uuid,
  p_artist uuid,
  p_dates uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_artist is null or coalesce(cardinality(p_dates), 0) = 0 then
    return;
  end if;

  -- Serialize all active-date changes for one artist. The deliberately coarse
  -- lock keeps both legacy single-date orders and aggregate children on the same
  -- race-safe path without relying on rows that may not exist yet.
  perform pg_advisory_xact_lock(
    hashtextextended(p_org::text || ':' || p_artist::text, 0)
  );

  if exists (
    select 1
    from public.hire_orders ho
    where ho.org_id = p_org
      and ho.artist_id = p_artist
      and ho.status <> 'void'
      and (
        ho.show_date_id = any(p_dates)
        or exists (
          select 1
          from public.hire_order_dates hod
          where hod.hire_order_id = ho.id
            and hod.show_date_id = any(p_dates)
        )
      )
  ) then
    raise exception 'active hire order already covers a selected date';
  end if;
end $$;

revoke execute on function public.assert_hire_order_dates_available(uuid, uuid, uuid[]) from public;
revoke execute on function public.assert_hire_order_dates_available(uuid, uuid, uuid[]) from anon, authenticated;
grant execute on function public.assert_hire_order_dates_available(uuid, uuid, uuid[]) to service_role;

create or replace function public.enforce_hire_order_date_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist uuid;
  v_status public.hire_order_status;
begin
  select artist_id, status
    into v_artist, v_status
  from public.hire_orders
  where id = new.hire_order_id
  for update;

  if v_artist is null or v_status = 'void' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.org_id::text || ':' || v_artist::text, 0)
  );

  if exists (
    select 1
    from public.hire_orders ho
    where ho.org_id = new.org_id
      and ho.artist_id = v_artist
      and ho.status <> 'void'
      and ho.id <> new.hire_order_id
      and (
        ho.show_date_id = new.show_date_id
        or exists (
          select 1
          from public.hire_order_dates hod
          where hod.hire_order_id = ho.id
            and hod.show_date_id = new.show_date_id
        )
      )
  ) then
    raise exception 'active hire order already covers a selected date';
  end if;

  return new;
end $$;

create trigger prevent_hire_order_date_overlap
  before insert or update on public.hire_order_dates
  for each row execute function public.enforce_hire_order_date_available();

create or replace function public.enforce_hire_order_dates_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_lock bigint;
  v_new_lock bigint;
begin
  if old.artist_id is not null then
    v_old_lock := hashtextextended(
      old.org_id::text || ':' || old.artist_id::text,
      0
    );
  end if;

  if new.artist_id is not null then
    v_new_lock := hashtextextended(
      new.org_id::text || ':' || new.artist_id::text,
      0
    );
  end if;

  -- Lock both identities in stable order. The old key serializes releases
  -- (voiding or moving an order) while the new key serializes acquisitions.
  if v_old_lock is not null
     and v_new_lock is not null
     and v_old_lock <> v_new_lock then
    perform pg_advisory_xact_lock(least(v_old_lock, v_new_lock));
    perform pg_advisory_xact_lock(greatest(v_old_lock, v_new_lock));
  elsif coalesce(v_old_lock, v_new_lock) is not null then
    perform pg_advisory_xact_lock(coalesce(v_old_lock, v_new_lock));
  end if;

  -- Parent and child organisation identity is an invariant independent of
  -- active status: moving a parent must not strand children in another org.
  if exists (
    select 1
    from public.hire_order_dates own_date
    join public.show_dates sd on sd.id = own_date.show_date_id
    where own_date.hire_order_id = new.id
      and (
        own_date.org_id is distinct from new.org_id
        or sd.org_id is distinct from new.org_id
      )
  ) then
    raise exception 'hire order date belongs to a different org';
  end if;

  if new.artist_id is null or new.status = 'void' then
    return new;
  end if;

  -- The existing partial unique index remains the legacy-vs-legacy backstop.
  -- This trigger adds the paths that cross the aggregate child table.
  if exists (
    select 1
    from public.hire_orders ho
    where ho.org_id = new.org_id
      and ho.artist_id = new.artist_id
      and ho.status <> 'void'
      and ho.id <> new.id
      and (
        (
          new.show_date_id is not null
          and exists (
            select 1
            from public.hire_order_dates hod
            where hod.hire_order_id = ho.id
              and hod.show_date_id = new.show_date_id
          )
        )
        or exists (
          select 1
          from public.hire_order_dates own_date
          where own_date.hire_order_id = new.id
            and (
              ho.show_date_id = own_date.show_date_id
              or exists (
                select 1
                from public.hire_order_dates other_date
                where other_date.hire_order_id = ho.id
                  and other_date.show_date_id = own_date.show_date_id
              )
            )
        )
      )
  ) then
    raise exception 'active hire order already covers a selected date';
  end if;

  return new;
end $$;

create trigger prevent_hire_order_dates_overlap
  before insert or update of org_id, artist_id, show_date_id, status on public.hire_orders
  for each row execute function public.enforce_hire_order_dates_available();

alter table public.hire_order_dates enable row level security;

create policy "Producers read hire order dates" on public.hire_order_dates
  for select to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or public.has_org_role(auth.uid(), org_id, 'producer')
  );

create policy org_isolation on public.hire_order_dates as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

grant select on public.hire_order_dates to authenticated;
