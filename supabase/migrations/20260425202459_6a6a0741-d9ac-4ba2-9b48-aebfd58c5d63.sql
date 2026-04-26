
-- Remove the overly permissive "view all artists" policy that bypassed contact-info restrictions
DROP POLICY IF EXISTS "Authenticated can view artist non-contact info" ON public.artists;

-- Restore column grants — RLS now controls which rows are visible
GRANT SELECT ON public.artists TO authenticated;
