-- email_health_snapshot / get_email_health: aggregation over email_send_log +
-- super-admin gate. get_email_health raises for non-super-admins (auth.uid()
-- is null in test → not super).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

-- Seed: 100 reached Resend, 94 delivered, 6 bounced.
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, delivered_at)
SELECT gen_random_uuid(), 'r'||g, 'offer_digest', g||'@t.test', 'delivered', now(), now(), now()
FROM generate_series(1,94) g;
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, bounced_at, error_message)
SELECT gen_random_uuid(), 'b'||g, 'offer_digest', g||'@b.test', 'bounced', now(), now(), now(), 'mailbox not found'
FROM generate_series(1,6) g;

-- A delivery can arrive after the originating send has fallen out of the
-- dashboard window. The analytics window follows the lifecycle event, not the
-- original attempt, otherwise real delivery events are silently omitted.
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, delivered_at)
VALUES (gen_random_uuid(), 'late-delivery', 'offer_digest', 'late@t.test', 'delivered', now() - interval '2 days', now() - interval '2 days', now());

-- A later complaint must supersede an earlier delivery when deciding whether
-- the lifecycle record belongs in the selected window.
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, delivered_at, complained_at)
VALUES (gen_random_uuid(), 'late-complaint', 'offer_digest', 'complaint@t.test', 'complained', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', now());

SELECT is((public.email_health_snapshot(1440)->>'sent')::int, 102, 'sent includes messages whose lifecycle events are inside the window');
SELECT is(round((public.email_health_snapshot(1440)->>'bounce_rate')::numeric, 3), 0.059, 'bounce_rate includes a late-arriving delivery event in its denominator');
SELECT is((public.email_health_snapshot(1440)->>'delivered')::int, 95, 'delivered counts a late-arriving delivery event');
SELECT is((public.email_health_snapshot(1440)->>'complained')::int, 1, 'a fresh complaint remains in the event window after an older delivery');
-- get_email_health raises for non-super-admins (auth.uid() is null in test → not super).
SELECT throws_ok('SELECT public.get_email_health(1440)', NULL, NULL, 'get_email_health rejects non-super-admin');

SELECT * FROM finish();
ROLLBACK;
