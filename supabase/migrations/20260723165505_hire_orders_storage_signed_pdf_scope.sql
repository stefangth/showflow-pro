-- Extend the artist-scoped hire-orders storage read policy to also grant the
-- linked artist their SIGNED copy (signed_pdf_path), not just the issued pdf_path.
-- Without this, download-url (which signs with the caller's own client so storage
-- RLS is the backstop) is denied for the artist on the `${org}/${order_no}-signed.pdf`
-- object once an order is signed, so the artist cannot download the very document
-- they signed. Producers/admins are unaffected (folder-wide grant). Feature ships
-- dark, so no live exposure; this closes before hire_orders is enabled.
-- A policy cannot be CREATE OR REPLACE'd, so drop and recreate under the same name.
drop policy if exists "Org members read own hire order pdfs" on storage.objects;

create policy "Org members read own hire order pdfs"
  on storage.objects for select to authenticated
  using (
    case
      when bucket_id = 'hire-orders' then
        public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
        or public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'producer')
        or exists (
          select 1
          from public.hire_orders ho
          join public.artists a on a.id = ho.artist_id
          where (ho.pdf_path = storage.objects.name or ho.signed_pdf_path = storage.objects.name)
            and a.user_id = auth.uid()
            and ho.status in ('issued', 'countersigned')
        )
      else false
    end
  );
