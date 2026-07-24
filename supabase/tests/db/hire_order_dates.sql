-- Aggregate hire-order dates and delivery timestamp persistence.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text,
    true
  );
END $$;

SET session_replication_role = replica;

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000334',
  'authenticated',
  'authenticated',
  'hire-order-dates-producer@example.com',
  now(),
  '{"provider":"email"}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000333', 'Hire Order Dates A', 'hire-order-dates-a'),
  ('00000000-0000-0000-0000-000000000444', 'Hire Order Dates B', 'hire-order-dates-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000333', '00000000-0000-0000-0000-000000000334', 'producer');

INSERT INTO public.org_entitlements (org_id, feature, enabled) VALUES
  ('00000000-0000-0000-0000-000000000333', 'hire_orders', true);

INSERT INTO public.artists (id, org_id, name) VALUES
  ('00000000-0000-0000-0000-000000000555', '00000000-0000-0000-0000-000000000444', 'Aggregate Artist'),
  ('00000000-0000-0000-0000-000000000777', '00000000-0000-0000-0000-000000000333', 'Single-Date Artist'),
  ('00000000-0000-0000-0000-000000000778', '00000000-0000-0000-0000-000000000333', 'RPC Artist'),
  ('00000000-0000-0000-0000-000000000779', '00000000-0000-0000-0000-000000000333', 'RPC Rollback Artist');

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('00000000-0000-0000-0000-000000000888', '00000000-0000-0000-0000-000000000333', 'theatre', 'hire-order-dates-a'),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000444', 'theatre', 'hire-order-dates-b');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-01', '19:00'),
  ('00000000-0000-0000-0000-000000000666', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-02', '19:00'),
  ('00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-04', '19:00'),
  ('00000000-0000-0000-0000-000000000671', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-05', '19:00'),
  ('00000000-0000-0000-0000-000000000667', '00000000-0000-0000-0000-000000000333', '00000000-0000-0000-0000-000000000888', '2099-10-03', '19:00'),
  ('00000000-0000-0000-0000-000000000669', '00000000-0000-0000-0000-000000000333', '00000000-0000-0000-0000-000000000888', '2099-10-06', '19:00'),
  ('00000000-0000-0000-0000-000000000670', '00000000-0000-0000-0000-000000000333', '00000000-0000-0000-0000-000000000888', '2099-10-07', '19:00');

INSERT INTO public.hire_orders (id, org_id, order_no, status, artist_id, show_date_id, data) VALUES
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000333', 'HO-DATES-1', 'draft', '00000000-0000-0000-0000-000000000777', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000444', 'HO-DATES-2', 'issued', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000998', '00000000-0000-0000-0000-000000000444', 'HO-DATES-3', 'ready', '00000000-0000-0000-0000-000000000555', '00000000-0000-0000-0000-000000000222', '{}'),
  ('00000000-0000-0000-0000-000000000997', '00000000-0000-0000-0000-000000000444', 'HO-DATES-4', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000996', '00000000-0000-0000-0000-000000000444', 'HO-DATES-5', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000995', '00000000-0000-0000-0000-000000000444', 'HO-DATES-6', 'countersigned', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000994', '00000000-0000-0000-0000-000000000444', 'HO-DATES-7', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}');

INSERT INTO public.hire_order_dates (hire_order_id, show_date_id, org_id, position) VALUES
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000667', '00000000-0000-0000-0000-000000000333', 0),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000666', '00000000-0000-0000-0000-000000000444', 0),
  ('00000000-0000-0000-0000-000000000995', '00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', 0);

SET session_replication_role = DEFAULT;

SELECT has_table('public', 'hire_order_dates', 'hire_order_dates table exists');
SELECT has_column('public', 'hire_orders', 'last_sent_at', 'last_sent_at column exists');
SELECT is_definer(
  'public',
  'create_hire_order_with_dates',
  ARRAY['uuid', 'text', 'uuid', 'uuid[]', 'jsonb', 'numeric', 'text', 'text', 'uuid'],
  'aggregate creation RPC is SECURITY DEFINER'
);

SELECT function_returns(
  'public',
  'create_hire_order_with_dates',
  ARRAY['uuid', 'text', 'uuid', 'uuid[]', 'jsonb', 'numeric', 'text', 'text', 'uuid'],
  'uuid',
  'aggregate creation RPC returns its parent id'
);

SELECT throws_matching(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000333', 0)$$,
  '.*hire order date belongs to a different org.*',
  'rejects a child date from another organisation'
);

SELECT throws_ok(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000667', '00000000-0000-0000-0000-000000000333', 1)$$,
  '23505',
  NULL,
  'rejects the same date twice on one hire order'
);

SELECT throws_matching(
  $$select public.assert_hire_order_dates_available(
      '00000000-0000-0000-0000-000000000444',
      '00000000-0000-0000-0000-000000000555',
      array['00000000-0000-0000-0000-000000000666']::uuid[])$$,
  '.*active hire order already covers.*',
  'blocks an active aggregate date already held by the artist'
);

SELECT throws_matching(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000997', '00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000444', 0)$$,
  '.*active hire order already covers.*',
  'blocks aggregate coverage that conflicts with a legacy order'
);

SELECT throws_matching(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000996', '00000000-0000-0000-0000-000000000666', '00000000-0000-0000-0000-000000000444', 0)$$,
  '.*active hire order already covers.*',
  'blocks aggregate coverage that conflicts with another aggregate'
);

SELECT throws_matching(
  $$update public.hire_orders
    set org_id = '00000000-0000-0000-0000-000000000444'
    where id = '00000000-0000-0000-0000-000000000111'$$,
  '.*hire order date belongs to a different org.*',
  'rejects moving a parent away from its attached show-date organisation'
);

SELECT pg_temp.act_as('00000000-0000-0000-0000-000000000334');
-- Ensure this assertion reaches the column guard even on clean local schemas
-- that do not retain Supabase's legacy automatic table grants.
GRANT SELECT, UPDATE ON public.hire_orders TO authenticated;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$update public.hire_orders
      set last_sent_at = '2099-10-08 12:00:00+00'
      where id = '00000000-0000-0000-0000-000000000111'$$,
  '42501',
  'last_sent_at is managed by the delivery service',
  'an authenticated producer cannot forge last_sent_at'
);
RESET ROLE;

SELECT is(
  (SELECT last_sent_at FROM public.hire_orders WHERE id = '00000000-0000-0000-0000-000000000111'),
  NULL::timestamptz,
  'a rejected producer update leaves last_sent_at unchanged'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$update public.hire_orders
      set last_sent_at = '2099-10-08 12:00:00+00'
      where id = '00000000-0000-0000-0000-000000000111'$$,
  'the service-role delivery path can stamp last_sent_at'
);
RESET ROLE;

SELECT is(
  (SELECT last_sent_at FROM public.hire_orders WHERE id = '00000000-0000-0000-0000-000000000111'),
  '2099-10-08 12:00:00+00'::timestamptz,
  'the trusted delivery timestamp is persisted'
);

SELECT throws_matching(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000671', '00000000-0000-0000-0000-000000000444', 1)$$,
  '.*issued hire order dates are immutable.*',
  'an issued parent rejects child insertion'
);

SELECT throws_matching(
  $$update public.hire_order_dates
      set position = 1
      where hire_order_id = '00000000-0000-0000-0000-000000000999'
        and show_date_id = '00000000-0000-0000-0000-000000000666'$$,
  '.*issued hire order dates are immutable.*',
  'an issued parent rejects child updates'
);

SELECT throws_matching(
  $$delete from public.hire_order_dates
      where hire_order_id = '00000000-0000-0000-0000-000000000999'
        and show_date_id = '00000000-0000-0000-0000-000000000666'$$,
  '.*issued hire order dates are immutable.*',
  'an issued parent rejects child deletion'
);

SELECT throws_matching(
  $$update public.hire_order_dates
      set position = 1
      where hire_order_id = '00000000-0000-0000-0000-000000000995'
        and show_date_id = '00000000-0000-0000-0000-000000000668'$$,
  '.*issued hire order dates are immutable.*',
  'a countersigned parent rejects child updates'
);

SELECT lives_ok(
  $$update public.hire_orders
      set status = 'void'
      where id = '00000000-0000-0000-0000-000000000995';
    insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
      values ('00000000-0000-0000-0000-000000000994', '00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', 0)$$,
  'voiding an aggregate releases its date for recreation'
);

-- Do not execute this SECURITY DEFINER RPC through pgTAP's dynamic
-- throws_ok() path as an unprivileged role: Postgres can crash while
-- resolving that denied call. Inspect the ACL directly instead.
SELECT ok(
  not has_function_privilege(
    'authenticated',
    'public.create_hire_order_with_dates(uuid,text,uuid,uuid[],jsonb,numeric,text,text,uuid)',
    'execute'
  ),
  'authenticated clients cannot execute the aggregate RPC'
);

SELECT ok(
  not has_function_privilege(
    'anon',
    'public.create_hire_order_with_dates(uuid,text,uuid,uuid[],jsonb,numeric,text,text,uuid)',
    'execute'
  ),
  'anonymous clients cannot execute the aggregate RPC'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.create_hire_order_with_dates(uuid,text,uuid,uuid[],jsonb,numeric,text,text,uuid)',
    'execute'
  ),
  'only the service role can execute the aggregate RPC'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE created_aggregate AS
SELECT public.create_hire_order_with_dates(
  '00000000-0000-0000-0000-000000000333',
  'HO-RPC-VALID',
  '00000000-0000-0000-0000-000000000778',
  array[
    '00000000-0000-0000-0000-000000000670',
    '00000000-0000-0000-0000-000000000669'
  ]::uuid[],
  '{"artist_name":{"value":"RPC Artist","source":"showflow"}}'::jsonb,
  1200,
  'EUR',
  'standard',
  '00000000-0000-0000-0000-000000000334'
) AS id;
RESET ROLE;

SELECT is(
  (
    SELECT ho.id
    FROM public.hire_orders ho
    JOIN created_aggregate created ON created.id = ho.id
    WHERE ho.org_id = '00000000-0000-0000-0000-000000000333'
      AND ho.artist_id = '00000000-0000-0000-0000-000000000778'
      AND ho.show_date_id IS NULL
      AND ho.status = 'draft'
  ),
  (SELECT id FROM created_aggregate),
  'the aggregate RPC returns its multi-date parent id without a legacy primary date'
);

SELECT results_eq(
  $$select hod.show_date_id, hod.position::int
      from public.hire_order_dates hod
      join created_aggregate created on created.id = hod.hire_order_id
      order by hod.position$$,
  $$values
      ('00000000-0000-0000-0000-000000000670'::uuid, 0),
      ('00000000-0000-0000-0000-000000000669'::uuid, 1)$$,
  'the aggregate RPC inserts every child date in caller order'
);

SET LOCAL ROLE service_role;
SELECT throws_matching(
  $$select public.create_hire_order_with_dates(
      '00000000-0000-0000-0000-000000000333',
      'HO-RPC-WRONG-ARTIST',
      '00000000-0000-0000-0000-000000000555',
      array['00000000-0000-0000-0000-000000000669']::uuid[],
      '{}'::jsonb, null, 'EUR', 'standard', null
    )$$,
  '.*artist belongs to a different org.*',
  'the aggregate RPC rejects an artist from another organisation'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE order_no = 'HO-RPC-WRONG-ARTIST'),
  0,
  'invalid artist assignment creates no parent'
);

SET LOCAL ROLE service_role;
SELECT throws_matching(
  $$select public.create_hire_order_with_dates(
      '00000000-0000-0000-0000-000000000333',
      'HO-RPC-WRONG-DATE',
      '00000000-0000-0000-0000-000000000778',
      array['00000000-0000-0000-0000-000000000222']::uuid[],
      '{}'::jsonb, null, 'EUR', 'standard', null
    )$$,
  '.*show date belongs to a different org.*',
  'the aggregate RPC rejects a show date from another organisation'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE order_no = 'HO-RPC-WRONG-DATE'),
  0,
  'invalid date assignment creates no parent'
);

SET LOCAL ROLE service_role;
SELECT throws_matching(
  $$select public.create_hire_order_with_dates(
      '00000000-0000-0000-0000-000000000333',
      'HO-RPC-OVERLAP',
      '00000000-0000-0000-0000-000000000777',
      array['00000000-0000-0000-0000-000000000667']::uuid[],
      '{}'::jsonb, null, 'EUR', 'standard', null
    )$$,
  '.*active hire order already covers a selected date.*',
  'the aggregate RPC validates availability before creation'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE order_no = 'HO-RPC-OVERLAP'),
  0,
  'an availability conflict creates no parent'
);

CREATE OR REPLACE FUNCTION pg_temp.reject_atomic_test_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.hire_orders ho
    WHERE ho.id = NEW.hire_order_id
      AND ho.order_no = 'HO-RPC-ROLLBACK'
  ) THEN
    RAISE EXCEPTION 'forced child failure';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER zzz_reject_atomic_test_child
  BEFORE INSERT ON public.hire_order_dates
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_atomic_test_child();

SET LOCAL ROLE service_role;
SELECT throws_matching(
  $$select public.create_hire_order_with_dates(
      '00000000-0000-0000-0000-000000000333',
      'HO-RPC-ROLLBACK',
      '00000000-0000-0000-0000-000000000779',
      array['00000000-0000-0000-0000-000000000669']::uuid[],
      '{}'::jsonb, null, 'EUR', 'standard', null
    )$$,
  '.*forced child failure.*',
  'a child insert failure aborts the aggregate RPC'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE order_no = 'HO-RPC-ROLLBACK'),
  0,
  'the failed child insert rolls back its already-inserted parent'
);

SELECT * FROM finish();
ROLLBACK;
