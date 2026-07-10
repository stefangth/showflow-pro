-- email_health_snapshot / get_email_health: aggregation over email_send_log +
-- super-admin gate. get_email_health raises for non-super-admins (auth.uid()
-- is null in test → not super).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

-- Seed: 100 reached Resend, 94 delivered, 6 bounced.
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, delivered_at)
SELECT gen_random_uuid(), 'r'||g, 'offer_digest', g||'@t.test', 'delivered', now(), now(), now()
FROM generate_series(1,94) g;
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, bounced_at, error_message)
SELECT gen_random_uuid(), 'b'||g, 'offer_digest', g||'@b.test', 'bounced', now(), now(), now(), 'mailbox not found'
FROM generate_series(1,6) g;

SELECT is((public.email_health_snapshot(1440)->>'sent')::int, 100, 'sent counts rows that reached Resend');
SELECT is(round((public.email_health_snapshot(1440)->>'bounce_rate')::numeric, 3), 0.060, 'bounce_rate = 6/100');
-- get_email_health raises for non-super-admins (auth.uid() is null in test → not super).
SELECT throws_ok('SELECT public.get_email_health(1440)', NULL, NULL, 'get_email_health rejects non-super-admin');

SELECT * FROM finish();
ROLLBACK;
