-- C2 — Restrict profiles SELECT to self + shared-org members (+ super-admin).
--
-- The original policy (20260416115633_...:58) was
--   "Anyone authenticated can view profiles" FOR SELECT USING (true)
-- and was never rewritten. `profiles` carries display_name + phone and has no org_id,
-- so any authenticated user could enumerate the name+phone of EVERY user on the
-- platform — a cross-tenant PII leak (GDPR-relevant).
--
-- Replacement policy permits a SELECT only when the row is the caller's own profile,
-- OR the caller shares an org with the target user, OR the caller is a super-admin.
--
-- Schema note: public.profiles.id is a surrogate PK distinct from user_id (the
-- auth.users FK). Org membership is keyed on the auth user, so the shared-org check
-- joins org_memberships on profiles.user_id — NOT profiles.id.
--
-- Helpers used (defined in 20260603120000_add_platform_tables_and_org_helpers.sql):
--   public.is_super_admin(uuid)  — SECURITY DEFINER, avoids RLS recursion.
-- The shared-org EXISTS is expressed directly against org_memberships (no helper takes
-- a "do these two users share an org?" shape); org_memberships' own RLS is bypassed
-- here because policy predicates evaluate as the table owner, not the caller.

DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;

CREATE POLICY "Users can view co-org and own profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.org_memberships m_self
      JOIN public.org_memberships m_target
        ON m_target.org_id = m_self.org_id
      WHERE m_self.user_id = auth.uid()
        AND m_target.user_id = public.profiles.user_id
    )
  );
