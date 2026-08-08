-- Make the artists contact-PII protection honest in the schema (no behavior change).
--
-- History: 20260425202310 tried to protect artists.email/phone with a column-level
-- REVOKE + safe-column GRANT, but 20260425202459 ran a blanket
-- `GRANT SELECT ON public.artists TO authenticated`, which re-granted the contact
-- columns and nullified the REVOKE. The intended column-level protection has been
-- dead since April 2026; the schema implied a protection it did not provide.
--
-- The REAL control is the RLS SELECT policies on public.artists (admin/producer see
-- all org artists; the linked artist sees their own record). Column grants cannot
-- express admin-vs-member because both are the same `authenticated` role, so they are
-- the wrong tool here and must not be relied on. This migration documents that, and
-- removes the vestigial `anon` contact-column grant as a harmless belt (anon reads no
-- artist rows under RLS regardless).

COMMENT ON COLUMN public.artists.email IS
  'PII. Readable only by admin/producer (all org artists) or the linked artist (self), '
  'enforced by the RLS SELECT policies on public.artists. Column grants do NOT gate this, do not rely on them.';

COMMENT ON COLUMN public.artists.phone IS
  'PII. Readable only by admin/producer (all org artists) or the linked artist (self), '
  'enforced by the RLS SELECT policies on public.artists. Column grants do NOT gate this, do not rely on them.';

-- Belt at the grant layer for the public/anon role (no-op behaviorally; anon has no
-- permissive SELECT policy on artists so it reads no rows either way).
REVOKE SELECT (email, phone) ON public.artists FROM anon;
