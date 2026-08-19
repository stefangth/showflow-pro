-- suppressed_emails has no org_id column (it is a global, email-keyed bounce/
-- complaint list), so the only existing SELECT policy is super-admin-only
-- (20260710231816_email_delivery_tables.sql). That leaves the Today board's
-- fetchBouncedAsks (src/data/autopilot.ts) unable to surface a bounced-ask
-- banner for an ordinary org admin/producer: the query always returns zero
-- rows for them.
--
-- Add a second, additive SELECT policy that scopes suppressed_emails through
-- the artist roster: a member may read a suppression row when that email
-- belongs to an artist in an org they belong to. This does NOT weaken or
-- replace the super-admin policy -- it is a second permissive policy, and
-- Postgres RLS ORs permissive policies together.
--
-- lower()/lower() email comparison matches house style (see e.g.
-- 20260701171851_bulk_import_artists.sql, 20260809170001_invite_membership_
-- and_self_heal.sql) rather than relying on exact-case equality.
CREATE POLICY "org members read suppressed_emails for their artists"
  ON public.suppressed_emails FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      WHERE lower(a.email) = lower(suppressed_emails.email)
        AND public.is_org_member(auth.uid(), a.org_id)
    )
  );
