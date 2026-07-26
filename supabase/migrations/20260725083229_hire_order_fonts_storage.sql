insert into storage.buckets (id, name, public)
values ('hire-order-fonts', 'hire-order-fonts', true)
on conflict (id) do nothing;

-- Public read, no writes from clients: fonts are uploaded by an operator with
-- the service role, never by an org. No INSERT/UPDATE/DELETE policies.
create policy "hire_order_fonts_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'hire-order-fonts');
