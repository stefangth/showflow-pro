-- Drop two dead columns confirmed unused by any code, trigger, policy, RPC, or feature.
--
-- profiles.avatar_url  — never written or rendered. Was reserved (ADR-0011) for a future
--   avatar-upload feature that is now CANCELLED (see ADR-0011 amendment, 2026-06-20). Avatars
--   are deterministic initials/colour (src/lib/avatar.ts) with no image source.
--   NOTE: artists.cast_role keeps its sibling reservation under ADR-0011 — intentionally NOT
--   dropped here.
-- shows.required_skills — orphaned shell of a never-built skills-matching feature. No reader,
--   writer, trigger, policy, or RPC references it; the skills / artist_skills tagging system is
--   separate and never consults it.
--
-- Ordering under `db reset`: both columns are created by the baseline migration, and
-- required_skills is commented by 20260517170000 — this migration runs after both, so each
-- column exists when those run and is then dropped here. Production is greenfield (no data loss).

ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE public.shows DROP COLUMN IF EXISTS required_skills;
