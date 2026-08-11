-- pgTAP: public.skill_catalog(p_org) scopes required_by_date_count to UPCOMING,
-- non-cancelled dates only (matching fetchUpcomingDateCountsBySkill on the client).
-- A skill required by a past or cancelled show_date must not inflate the count the
-- UI presents as "N upcoming dates" / "required by upcoming dates".
--
-- Fixtures attach to the seeded Bootstrap Org (00000000-0000-0000-0000-00000000b007,
-- from supabase/seed.sql) and its seeded show.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(2);

-- A skill required by three dates: one upcoming, one past, one upcoming-but-cancelled.
INSERT INTO public.skills (id, org_id, name) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b007', 'pgTAP catalog date skill'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b007', 'pgTAP catalog no-date skill');

INSERT INTO public.show_dates (id, show_id, date, session_1, status, org_id) VALUES
  ('bbbbbbbb-d000-0000-0000-000000000001',
    (SELECT id FROM public.shows WHERE org_id = '00000000-0000-0000-0000-00000000b007' LIMIT 1),
    current_date + 30, '19:00'::time, 'open', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-d000-0000-0000-000000000002',
    (SELECT id FROM public.shows WHERE org_id = '00000000-0000-0000-0000-00000000b007' LIMIT 1),
    current_date - 30, '19:00'::time, 'open', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-d000-0000-0000-000000000003',
    (SELECT id FROM public.shows WHERE org_id = '00000000-0000-0000-0000-00000000b007' LIMIT 1),
    current_date + 60, '19:00'::time, 'cancelled', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_date_required_skills (org_id, show_date_id, skill_id) VALUES
  ('00000000-0000-0000-0000-00000000b007', 'bbbbbbbb-d000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000b007', 'bbbbbbbb-d000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000b007', 'bbbbbbbb-d000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001');

-- Only the one upcoming, non-cancelled date is counted (past + cancelled excluded).
SELECT is(
  (SELECT required_by_date_count
     FROM public.skill_catalog('00000000-0000-0000-0000-00000000b007')
    WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1::bigint,
  'required_by_date_count counts only upcoming, non-cancelled dates (past and cancelled excluded)'
);

-- A skill required by no date at all reports 0.
SELECT is(
  (SELECT required_by_date_count
     FROM public.skill_catalog('00000000-0000-0000-0000-00000000b007')
    WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0::bigint,
  'a skill required by no upcoming date reports 0'
);

SELECT * FROM finish();
ROLLBACK;
