insert into storage.buckets (id, name, public) values ('hire-orders', 'hire-orders', false)
  on conflict (id) do nothing;

create policy "Org members read own hire order pdfs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hire-orders'
    and public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
-- No INSERT/UPDATE/DELETE policies: writes go through the service role only.
