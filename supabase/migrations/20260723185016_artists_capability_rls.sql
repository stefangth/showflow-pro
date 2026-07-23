-- Plan 3, Phase 1.4: capability-aware write RLS on artists.
-- Producer UPDATE gated on producer_can_edit_artists; a NEW producer INSERT
-- policy gated on producer_can_add_artists (there was none before — single-add
-- was admin-only; default-on cap intentionally grants it). Admin FOR ALL
-- ("Admins can manage artists") and artist self-policies are untouched.
-- SELECT policies untouched (read-only floor).
drop policy "Producers can update artists" on public.artists;
create policy "Producers can update artists" on public.artists for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_edit_artists')
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_edit_artists')
  );

create policy "Producers can insert artists" on public.artists for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_capability_enabled(org_id, 'producer_can_add_artists')
  );
