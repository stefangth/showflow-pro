-- Plan 3, Phase 1.9c (HIGH RISK): transition-gated write RLS on hire_orders.
-- The old "Producers manage hire orders" FOR ALL policy (using admin OR producer;
-- check (admin OR producer) AND is_feature_enabled(org,'hire_orders')) is split so
-- that a producer WRITE that lands 'void' requires producer_can_void_hire_orders and
-- one that lands 'countersigned' requires producer_can_manage_countersign, while all
-- other producer writes (draft edits, etc.) and reads are unchanged. The hire_orders
-- MODULE gate (is_feature_enabled) is preserved in both arms' WITH CHECK. Admin always.
-- Artist read policy ("Artists read own issued orders") and org_isolation untouched.
drop policy "Producers manage hire orders" on public.hire_orders;

create policy "Admins manage hire orders" on public.hire_orders for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    and public.is_feature_enabled(org_id, 'hire_orders')
  );

create policy "Producers manage hire orders" on public.hire_orders for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and public.is_feature_enabled(org_id, 'hire_orders')
    and (status <> 'void'::hire_order_status
         or public.is_capability_enabled(org_id, 'producer_can_void_hire_orders'))
    and (status <> 'countersigned'::hire_order_status
         or public.is_capability_enabled(org_id, 'producer_can_manage_countersign'))
  );
