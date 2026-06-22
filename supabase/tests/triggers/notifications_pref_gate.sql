-- gate_notification_pref: disabled category is skipped; enabled/unmapped inserted.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000009b0','authenticated','authenticated','gate@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000009c0','GateOrg','gate-org');
INSERT INTO public.notification_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-0000000009b0','{"at_risk":{"in_app":false}}'::jsonb);
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

SELECT * FROM finish();
ROLLBACK;
