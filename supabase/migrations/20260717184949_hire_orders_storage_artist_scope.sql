-- Scope hire-orders storage reads to mirror the hire_orders TABLE's RLS access
-- model, closing an intra-org cross-artist disclosure path.
--
-- The prior policy (20260717133506_hire_orders_storage_guarded_cast.sql) granted
-- SELECT to ANY org member of the object's org folder:
--   is_org_member(auth.uid(), (foldername[1])::uuid)
-- But the hire_orders table restricts artists to their OWN issued/countersigned
-- orders ("Artists read own issued orders" in 20260717102508). So an artist could
-- bypass the gated download-url edge action and call
--   storage.from('hire-orders').createSignedUrl('<org_id>/<order_no>.pdf')
-- directly with their own JWT; since order_no is predictable
-- (HO-{yyyy}-{mmdd}-{castcode|seq}) and castmates know the date+cast, a peer's
-- fees/terms were enumerable. Cross-ORG isolation always held (is_org_member is
-- org-scoped); this was intra-org, artist-to-artist. Feature ships dark so there
-- was no live exposure, but this closes before hire_orders is ever enabled.
--
-- New model mirrors the table exactly:
--   * org admins/producers -> the whole org folder (has_org_role on foldername[1]),
--     same as "Producers manage hire orders".
--   * artists -> ONLY the storage object that IS their own issued/countersigned
--     order's pdf, joined by hire_orders.pdf_path = storage.objects.name (T8's
--     generate-hire-orders uploads to exactly `${org}/${order_no}.pdf` and stores
--     that same string in pdf_path), same as "Artists read own issued orders".
--
-- The CASE cast-guard is KEPT: for any bucket other than 'hire-orders' the qual
-- short-circuits to false and the ((storage.foldername(name))[1])::uuid cast is
-- never evaluated, so the cross-bucket 22P02 hazard stays closed. A policy cannot
-- be CREATE OR REPLACE'd, so drop and recreate under the same name.
--
-- Still SELECT-only for authenticated; writes remain service-role-only (no
-- INSERT/UPDATE/DELETE policies), so the upload path is unaffected.
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
          where ho.pdf_path = storage.objects.name
            and a.user_id = auth.uid()
            and ho.status in ('issued', 'countersigned')
        )
      else false
    end
  );
