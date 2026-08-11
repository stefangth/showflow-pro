-- hire_orders.viewed_at (nullable timestamptz) + public.mark_hire_order_seen(p_order):
-- stamps viewed_at the first time the LINKED artist views an issued/countersigned
-- order. Idempotent -- a second call never overwrites the first timestamp. Rejects
-- (42501, leaving viewed_at untouched) any other user, and any order not yet
-- issued (draft/ready/void).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('11111111-2222-3333-0001-000000000001','authenticated','authenticated','hos-artist-a@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('11111111-2222-3333-0001-000000000002','authenticated','authenticated','hos-other-user@x.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('11111111-2222-3333-0002-000000000001','Hire Order Seen Org','hire-order-seen-org');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('11111111-2222-3333-0002-000000000001','11111111-2222-3333-0001-000000000001','artist'),
  ('11111111-2222-3333-0002-000000000001','11111111-2222-3333-0001-000000000002','artist');

-- Artist A (uA is the linked user); a second artist has no linked user so uB is
-- simply "some other authenticated user", never the linked artist for any order.
INSERT INTO public.artists (id, org_id, name, user_id) VALUES
  ('11111111-2222-3333-0003-000000000001','11111111-2222-3333-0002-000000000001','Hire Order Seen Artist A','11111111-2222-3333-0001-000000000001');

INSERT INTO public.hire_orders (id, org_id, order_no, status, artist_id, data) VALUES
  ('11111111-2222-3333-0004-000000000001','11111111-2222-3333-0002-000000000001','HOS-ISSUED-1','issued','11111111-2222-3333-0003-000000000001','{}'),
  ('11111111-2222-3333-0004-000000000002','11111111-2222-3333-0002-000000000001','HOS-DRAFT-1','draft','11111111-2222-3333-0003-000000000001','{}');
SET session_replication_role = DEFAULT;

-- 1-2. Shape: hire_orders.viewed_at exists and is nullable.
SELECT has_column('public', 'hire_orders', 'viewed_at', 'hire_orders has a viewed_at column');
SELECT col_is_null('public', 'hire_orders', 'viewed_at', 'viewed_at is nullable');

-- 3. Baseline: freshly issued order has no viewed_at yet.
SELECT ok(
  (SELECT viewed_at IS NULL FROM public.hire_orders WHERE id = '11111111-2222-3333-0004-000000000001'),
  'viewed_at starts null on the issued order');

-- 4. Called as the linked artist (uA): first call sets viewed_at non-null.
SELECT pg_temp.act_as('11111111-2222-3333-0001-000000000001');
SET LOCAL ROLE authenticated;
SELECT public.mark_hire_order_seen('11111111-2222-3333-0004-000000000001');
RESET ROLE;
SELECT ok(
  (SELECT viewed_at IS NOT NULL FROM public.hire_orders WHERE id = '11111111-2222-3333-0004-000000000001'),
  'first call stamps viewed_at');

-- Capture the stamped timestamp so the idempotency + rejection checks below can
-- confirm it never moves.
SELECT set_config('hos.first_viewed_at', (SELECT viewed_at::text FROM public.hire_orders WHERE id = '11111111-2222-3333-0004-000000000001'), true);

-- 5. A second call from the same artist does NOT change it (idempotent).
SELECT pg_temp.act_as('11111111-2222-3333-0001-000000000001');
SET LOCAL ROLE authenticated;
SELECT public.mark_hire_order_seen('11111111-2222-3333-0004-000000000001');
RESET ROLE;
SELECT is(
  (SELECT viewed_at::text FROM public.hire_orders WHERE id = '11111111-2222-3333-0004-000000000001'),
  current_setting('hos.first_viewed_at'),
  'a second call from the linked artist leaves the original timestamp unchanged');

-- 6. Called as a DIFFERENT user: rejected with 42501, and viewed_at untouched.
SELECT pg_temp.act_as('11111111-2222-3333-0001-000000000002');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.mark_hire_order_seen('11111111-2222-3333-0004-000000000001') $$,
  '42501', NULL, 'a different user is rejected');
RESET ROLE;
SELECT is(
  (SELECT viewed_at::text FROM public.hire_orders WHERE id = '11111111-2222-3333-0004-000000000001'),
  current_setting('hos.first_viewed_at'),
  'the rejected call from a different user left viewed_at untouched');

-- 7. Called on a DRAFT order by its own linked artist: rejected with 42501.
SELECT pg_temp.act_as('11111111-2222-3333-0001-000000000001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.mark_hire_order_seen('11111111-2222-3333-0004-000000000002') $$,
  '42501', NULL, 'a draft order is rejected (not yet issued)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
