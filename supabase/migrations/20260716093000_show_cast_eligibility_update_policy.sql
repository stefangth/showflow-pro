-- show_cast_eligibility predates any UPDATE path: the original migration
-- (20260421170151) only ever granted SELECT, INSERT, and DELETE to
-- authenticated users, plus the later RESTRICTIVE org_isolation policy.
-- The configurable eligibility phase (20260715130000) added the first UPDATE
-- callers: setShowCastPriority's update branch and clearShowCastPriority in
-- src/data/eligibility.ts write priority via UPDATE. With no permissive
-- UPDATE policy, RLS filters those statements to zero rows: supabase-js
-- does not surface an error for a zero-row update, so the UI toasts success
-- while the row never changes. This adds the missing permissive policy,
-- scoped the same way as the existing INSERT and DELETE policies.

CREATE POLICY "Admins and producers can update show cast eligibility"
  ON public.show_cast_eligibility FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));
