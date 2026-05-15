-- Producers manage Production Ownership assignments, which requires listing
-- assignable producers/admins. Without this policy a producer's
-- `from('user_roles').select(...)` returns only their own row, leaving the
-- Producer dropdown empty.
CREATE POLICY "Producers can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'producer'::public.app_role));
