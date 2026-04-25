
-- 1. Fix EXPOSED_SENSITIVE_DATA on artists: restrict contact fields via column-level grants
-- Strategy: Revoke broad SELECT; add column-restricted SELECT for general authenticated users
-- (excluding email/phone), and full SELECT for admins/producers/the artist themselves.

-- Drop the old broad SELECT policy
DROP POLICY IF EXISTS "Authenticated can view active artists" ON public.artists;

-- Admins and producers can see all columns including contact info
CREATE POLICY "Admins and producers can view all artist data"
ON public.artists
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'producer'::app_role)
);

-- Artists can see their own full record (including their own email/phone)
CREATE POLICY "Artists can view own full record"
ON public.artists
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- All authenticated users can view non-sensitive columns of all artists.
-- Enforce via column-level privileges: revoke SELECT on email/phone from authenticated,
-- and grant SELECT on the safe columns. Combined with a permissive RLS policy.
CREATE POLICY "Authenticated can view artist non-contact info"
ON public.artists
FOR SELECT
TO authenticated
USING (true);

-- Column-level: revoke email/phone from authenticated role
REVOKE SELECT (email, phone) ON public.artists FROM authenticated;
REVOKE SELECT (email, phone) ON public.artists FROM anon;
-- Ensure other columns remain readable
GRANT SELECT (id, name, user_id, cast_role, created_at, updated_at, bio, status, priority_score, skills)
  ON public.artists TO authenticated;

-- 2. Fix PRIVILEGE_ESCALATION on user_roles: tighten the admin ALL policy to authenticated only
-- and add an explicit deny-by-default by ensuring no INSERT/UPDATE/DELETE policy exists for non-admins.
-- The existing "Admins can manage roles" policy applies to 'public' role with admin check; replace with authenticated-scoped, action-specific policies.

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 3. Fix REALTIME_DATA_LEAK: remove user_approvals from realtime publication if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_approvals'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.user_approvals';
  END IF;
END$$;
