-- pgTAP: show_required_skills is a recompute-maintained cache. Direct client writes are
-- revoked (20260812160000), while recompute_show_slot_derivations (SECURITY DEFINER) still
-- maintains it. Fixtures attach to the seeded Bootstrap Org (supabase/seed.sql).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- (1) The `authenticated` client role can no longer write the cache directly.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.show_required_skills', 'INSERT'),
  'authenticated has no INSERT on show_required_skills (direct client writes revoked)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.show_required_skills', 'DELETE'),
  'authenticated has no DELETE on show_required_skills'
);

-- (2) recompute_show_slot_derivations still maintains the cache: adding a slot and a
-- per-slot required skill derives the matching show_required_skills row through the
-- SECURITY DEFINER recompute trigger (which bypasses the client-role revoke).
INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'theatre', 'lock-test', '00000000-0000-0000-0000-00000000b007');
INSERT INTO public.skills (id, org_id, name)
VALUES ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b007', 'pgTAP lock skill');
INSERT INTO public.show_slots (id, show_id, org_id, name, slot_count, kind, sort_order)
VALUES ('cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000b007', 'Main', 1, 'main', 0);
INSERT INTO public.show_slot_required_skills (slot_id, skill_id, org_id)
VALUES ('cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT count(*) FROM public.show_required_skills
    WHERE show_id = 'cccccccc-0000-0000-0000-000000000001'
      AND skill_id = 'cccccccc-0000-0000-0000-000000000002'),
  1::bigint,
  'recompute still maintains show_required_skills (SECURITY DEFINER bypasses the client revoke)'
);

SELECT * FROM finish();
ROLLBACK;
