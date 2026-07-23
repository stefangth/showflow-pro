-- Aggregate hire-order dates and delivery timestamp persistence.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000333', 'Hire Order Dates A', 'hire-order-dates-a'),
  ('00000000-0000-0000-0000-000000000444', 'Hire Order Dates B', 'hire-order-dates-b');

INSERT INTO public.artists (id, org_id, name) VALUES
  ('00000000-0000-0000-0000-000000000555', '00000000-0000-0000-0000-000000000444', 'Aggregate Artist'),
  ('00000000-0000-0000-0000-000000000777', '00000000-0000-0000-0000-000000000333', 'Single-Date Artist');

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('00000000-0000-0000-0000-000000000888', '00000000-0000-0000-0000-000000000333', 'theatre', 'hire-order-dates-a'),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000444', 'theatre', 'hire-order-dates-b');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-01', '19:00'),
  ('00000000-0000-0000-0000-000000000666', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-02', '19:00'),
  ('00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000999', '2099-10-04', '19:00'),
  ('00000000-0000-0000-0000-000000000667', '00000000-0000-0000-0000-000000000333', '00000000-0000-0000-0000-000000000888', '2099-10-03', '19:00');

INSERT INTO public.hire_orders (id, org_id, order_no, status, artist_id, show_date_id, data) VALUES
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000333', 'HO-DATES-1', 'draft', '00000000-0000-0000-0000-000000000777', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000444', 'HO-DATES-2', 'ready', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000998', '00000000-0000-0000-0000-000000000444', 'HO-DATES-3', 'ready', '00000000-0000-0000-0000-000000000555', '00000000-0000-0000-0000-000000000222', '{}'),
  ('00000000-0000-0000-0000-000000000997', '00000000-0000-0000-0000-000000000444', 'HO-DATES-4', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000996', '00000000-0000-0000-0000-000000000444', 'HO-DATES-5', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000995', '00000000-0000-0000-0000-000000000444', 'HO-DATES-6', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}'),
  ('00000000-0000-0000-0000-000000000994', '00000000-0000-0000-0000-000000000444', 'HO-DATES-7', 'draft', '00000000-0000-0000-0000-000000000555', NULL, '{}');

INSERT INTO public.hire_order_dates (hire_order_id, show_date_id, org_id, position) VALUES
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000667', '00000000-0000-0000-0000-000000000333', 0),
  ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000666', '00000000-0000-0000-0000-000000000444', 0),
  ('00000000-0000-0000-0000-000000000995', '00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', 0);

SET session_replication_role = DEFAULT;

SELECT has_table('public', 'hire_order_dates', 'hire_order_dates table exists');
SELECT has_column('public', 'hire_orders', 'last_sent_at', 'last_sent_at column exists');

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

SELECT lives_ok(
  $$update public.hire_orders
      set status = 'void'
      where id = '00000000-0000-0000-0000-000000000995';
    insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
      values ('00000000-0000-0000-0000-000000000994', '00000000-0000-0000-0000-000000000668', '00000000-0000-0000-0000-000000000444', 0)$$,
  'voiding an aggregate releases its date for recreation'
);

SELECT * FROM finish();
ROLLBACK;
