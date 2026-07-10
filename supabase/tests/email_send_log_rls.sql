-- supabase/tests/email_send_log_rls.sql
BEGIN;
SELECT plan(4);
SELECT has_table('public', 'email_send_log', 'email_send_log exists');
SELECT has_table('public', 'suppressed_emails', 'suppressed_emails exists');
SELECT has_table('public', 'email_unsubscribe_tokens', 'email_unsubscribe_tokens exists');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_send_log'::regclass),
  true, 'RLS enabled on email_send_log');
SELECT * FROM finish();
ROLLBACK;
