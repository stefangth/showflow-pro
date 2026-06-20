-- Tests for log_show_date_schedule_change (migration 20260620140000):
--   * session add / remove / retime each log one row with the right type/slot/values
--   * a transition to cancelled logs exactly one 'cancelled' row (no session noise)
--   * a fill-state status change (open→partially_filled) logs nothing
--   * a no-op update and a revival (cancelled→open) log nothing
--   * session_1 accepts NULL (incl. an all-null-sessions row)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-0c10-0001-0000-000000000000', 'theatre', 'musical', 1, 1, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0c10-0001-0000-000000000000', 'cccccccc-0c10-0001-0000-000000000000', '2099-09-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

-- 1. session_2 added (null → time)
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_2 = '20:00'::time WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 1, 'session add logs one row');
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_added', 'add → session_added');
SELECT is((SELECT session_slot FROM public.show_date_change_log), 2::smallint, 'add → slot 2');

-- 2. session_1 retimed
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_1 = '18:30'::time WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_retimed', 'change → session_retimed');

-- 3. session_1 removed (time → null)  [session_1 is now nullable]
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_1 = NULL WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_removed', 'null → session_removed');

-- 4. cancellation: one 'cancelled' row, no session rows even when sessions change too
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'cancelled', session_2 = NULL WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 1, 'cancellation logs exactly one row');
SELECT is((SELECT change_type FROM public.show_date_change_log), 'cancelled', 'cancellation → cancelled row');

-- 5. revival cancelled→open logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'open' WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'revival logs nothing');

-- 6. fill-state status change logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'partially_filled' WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'fill-state status change logs nothing');

-- 7. no-op update logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_3 = session_3 WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'no-op update logs nothing');

-- 8. session_1 nullable: an all-null-sessions show_date inserts fine
SELECT lives_ok($$
  INSERT INTO public.show_dates (id, show_id, date, org_id)
  VALUES ('dddddddd-0c10-0002-0000-000000000000', 'cccccccc-0c10-0001-0000-000000000000', '2099-09-02', '00000000-0000-0000-0000-00000000b007')
$$, 'show_date with all-null sessions inserts (session_1 nullable)');

SELECT * FROM finish();
ROLLBACK;
