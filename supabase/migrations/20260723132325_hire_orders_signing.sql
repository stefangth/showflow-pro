-- In-app electronic signing: signed-PDF path, issued-document hash, and the
-- append-only signature audit table. Purely additive: enforce_hire_order_transition
-- does not freeze these columns, so the issued->countersigned sign update needs no
-- trigger change.

alter table public.hire_orders add column signed_pdf_path text;
alter table public.hire_orders add column issued_pdf_sha256 text;

-- Allow the new 'electronic' countersign mode. 'documenso' stays in the allowed set
-- for the dormant Documenso branch + any historical rows.
alter table public.hire_orders drop constraint hire_orders_countersign_mode_check;
alter table public.hire_orders add constraint hire_orders_countersign_mode_check
  check (countersign_mode in ('manual','documenso','electronic'));

create table public.hire_order_signatures (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  hire_order_id        uuid not null references public.hire_orders(id) on delete cascade,
  signer_user_id       uuid references auth.users(id),
  signer_name          text not null,
  signer_email         text,
  method               text not null check (method in ('typed','drawn')),
  typed_name           text,
  signature_image_path text,
  signed_at            timestamptz not null,
  ip                   text,
  user_agent           text,
  consent_text         text not null,
  document_sha256      text,
  created_at           timestamptz not null default now(),
  unique (hire_order_id)
);

create index hire_order_signatures_org_idx on public.hire_order_signatures (org_id);

alter table public.hire_order_signatures enable row level security;

-- Read: org producers/admins, plus the linked artist of the order.
create policy "Producers read hire order signatures" on public.hire_order_signatures
  for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));

create policy "Artists read own hire order signatures" on public.hire_order_signatures
  for select to authenticated
  using (
    hire_order_id in (
      select ho.id from public.hire_orders ho
      join public.artists a on a.id = ho.artist_id
      where a.user_id = auth.uid()
    )
  );

-- Pooled multi-tenancy isolation (RESTRICTIVE). No permissive INSERT/UPDATE/DELETE
-- policy exists, so the table is service-role-write-only (the sign edge action).
create policy org_isolation on public.hire_order_signatures as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
