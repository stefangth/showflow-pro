create type public.hire_order_status as enum ('draft','ready','issued','countersigned','void');

create table public.hire_order_imports (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  source     text not null check (source in ('xlsx','csv','gsheet')),
  file_name  text,
  mapping    jsonb not null,
  row_count  integer not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.hire_orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  order_no              text not null,
  status                public.hire_order_status not null default 'draft',
  booking_id            uuid references public.bookings(id) on delete set null,
  artist_id             uuid references public.artists(id) on delete set null,
  show_date_id          uuid references public.show_dates(id) on delete set null,
  data                  jsonb not null,
  fee_amount            numeric(10,2),
  fee_currency          text not null default 'EUR',
  terms_variant         text not null default 'standard' check (terms_variant in ('lean','standard','full')),
  pdf_path              text,
  countersign_mode      text check (countersign_mode in ('manual','documenso')),
  documenso_envelope_id text,
  import_id             uuid references public.hire_order_imports(id) on delete set null,
  created_by            uuid references auth.users(id),
  issued_at             timestamptz,
  countersigned_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, order_no)
);

create unique index hire_orders_active_booking_uniq
  on public.hire_orders (booking_id)
  where booking_id is not null and status <> 'void';
create index hire_orders_org_status_idx on public.hire_orders (org_id, status, created_at desc);
create index hire_orders_show_date_idx on public.hire_orders (show_date_id) where show_date_id is not null;
create index hire_orders_artist_idx on public.hire_orders (artist_id) where artist_id is not null;

create trigger update_hire_orders_updated_at before update on public.hire_orders
  for each row execute function public.update_updated_at_column();

-- Org consistency: linked entities must belong to org_id (mirror derive_org_id_for_booking).
create or replace function public.derive_org_for_hire_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is not null and
     (select org_id from public.bookings where id = new.booking_id) <> new.org_id then
    raise exception 'booking belongs to a different org';
  end if;
  if new.artist_id is not null and
     (select org_id from public.artists where id = new.artist_id) <> new.org_id then
    raise exception 'artist belongs to a different org';
  end if;
  if new.show_date_id is not null and
     (select org_id from public.show_dates where id = new.show_date_id) <> new.org_id then
    raise exception 'show date belongs to a different org';
  end if;
  return new;
end $$;
create trigger derive_org_for_hire_order before insert or update of booking_id, artist_id, show_date_id
  on public.hire_orders for each row execute function public.derive_org_for_hire_order();

-- Lifecycle guard (mirror enforce_booking_transition, 20260714104826).
create or replace function public.enforce_hire_order_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then null;
  elsif old.status = 'draft'         and new.status in ('ready','void') then null;
  elsif old.status = 'ready'         and new.status in ('draft','issued','void') then null;
  elsif old.status = 'issued'        and new.status in ('countersigned','void') then null;
  elsif old.status = 'countersigned' and new.status = 'void' then null;
  else raise exception 'invalid hire order transition % -> %', old.status, new.status;
  end if;
  -- Issued documents are frozen: only status machinery may move.
  if old.status in ('issued','countersigned') and (
       new.data is distinct from old.data
    or new.fee_amount is distinct from old.fee_amount
    or new.fee_currency is distinct from old.fee_currency
    or new.terms_variant is distinct from old.terms_variant
    or new.order_no is distinct from old.order_no
    or new.pdf_path is distinct from old.pdf_path
  ) then
    raise exception 'issued hire orders are immutable';
  end if;
  return new;
end $$;
create trigger enforce_hire_order_transition before update on public.hire_orders
  for each row execute function public.enforce_hire_order_transition();

-- RLS
alter table public.hire_orders enable row level security;
alter table public.hire_order_imports enable row level security;

create policy "Producers manage hire orders" on public.hire_orders
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
    and public.is_feature_enabled(org_id, 'hire_orders')
  );

create policy "Artists read own issued orders" on public.hire_orders
  for select to authenticated
  using (
    status in ('issued','countersigned')
    and artist_id in (select id from public.artists where user_id = auth.uid())
  );

create policy org_isolation on public.hire_orders as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create policy "Producers manage hire order imports" on public.hire_order_imports
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
    and public.is_feature_enabled(org_id, 'hire_orders')
  );
create policy org_isolation on public.hire_order_imports as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
