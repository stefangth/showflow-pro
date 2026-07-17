-- gate_notification_pref: disabled category is skipped; enabled/unmapped inserted.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000009b0','authenticated','authenticated','gate@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000009c0','GateOrg','gate-org');
INSERT INTO public.notification_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-0000000009b0','{"at_risk":{"in_app":false},"booking_offers":{"in_app":false},"hire_orders":{"in_app":false}}'::jsonb);
SET session_replication_role = DEFAULT;

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','tier_at_risk','x');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='tier_at_risk'),
          0, 'disabled in_app category is skipped');

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','booking_confirmed','y');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='booking_confirmed'),
          1, 'enabled category is inserted');

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','some_future_type','z');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='some_future_type'),
          1, 'unmapped type is always inserted');

-- Milestone C (Task 12): the two new in-app types map through category_of()
-- into existing categories, so a disabled category pref swallows them too.
INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','offer_expiring','w');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='offer_expiring'),
          0, 'offer_expiring (booking_offers) — disabled in_app category is skipped');

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','tier_escalated','v');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='tier_escalated'),
          0, 'tier_escalated (at_risk) — disabled in_app category is skipped');

-- Task 10: the three hire_orders in-app types map through category_of() into the new
-- 'hire_orders' category, so a disabled category pref swallows them too.
INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','hire_orders_ready','u1');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='hire_orders_ready'),
          0, 'hire_orders_ready (hire_orders) — disabled in_app category is skipped');

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','hire_order_issued','u2');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='hire_order_issued'),
          0, 'hire_order_issued (hire_orders) — disabled in_app category is skipped');

INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','hire_order_countersigned','u3');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='hire_order_countersigned'),
          0, 'hire_order_countersigned (hire_orders) — disabled in_app category is skipped');

SELECT * FROM finish();
ROLLBACK;
