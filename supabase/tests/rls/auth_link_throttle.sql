-- pgTAP: auth_link_throttle grant-layer denial + claim_login_link_slot behavior.
--
-- auth_link_throttle is auth infrastructure (per-email cooldown for server-minted
-- magic-link / re-invite links). It is NOT tenant data: no org_id, RLS enabled with
-- ZERO policies, and all grants revoked from anon/authenticated. Only the service role
-- (via the SECURITY DEFINER claim_login_link_slot RPC) reads or writes it. This test
-- proves the deny-all posture at the grant layer (a downgraded `authenticated` role
-- hits 42501, not an empty result) and pins the atomic-claim + prune semantics,
-- including the coupling regression: a >1-day cooldown must not prune a row still
-- inside its window.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- Structure + RLS posture
SELECT has_table('public', 'auth_link_throttle', 'auth_link_throttle table exists');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_link_throttle'::regclass),
  true, 'RLS is enabled on auth_link_throttle');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auth_link_throttle'),
  0, 'auth_link_throttle has zero policies (deny-all at grant layer)');

-- Grant-layer denial: downgrade to the authenticated role so the revoked grant applies.
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM public.auth_link_throttle $$, '42501', NULL,
  'authenticated cannot SELECT auth_link_throttle');
SELECT throws_ok($$ INSERT INTO public.auth_link_throttle(email) VALUES ('a@x.com') $$, '42501', NULL,
  'authenticated cannot INSERT auth_link_throttle');
SELECT throws_ok($$ UPDATE public.auth_link_throttle SET last_sent_at = now() $$, '42501', NULL,
  'authenticated cannot UPDATE auth_link_throttle');
SELECT throws_ok($$ DELETE FROM public.auth_link_throttle $$, '42501', NULL,
  'authenticated cannot DELETE auth_link_throttle');
SELECT throws_ok($$ SELECT public.claim_login_link_slot('a@x.com', 60) $$, '42501', NULL,
  'authenticated cannot EXECUTE claim_login_link_slot');
RESET ROLE;

-- RPC behavior (superuser/service context in the test harness).
SELECT is(public.claim_login_link_slot('claim@x.com', 60), true,
  'first claim for a fresh email returns true');
SELECT is(public.claim_login_link_slot('claim@x.com', 60), false,
  'immediate second claim returns false (within cooldown)');

UPDATE public.auth_link_throttle SET last_sent_at = now() - interval '2 minutes' WHERE email = 'claim@x.com';
SELECT is(public.claim_login_link_slot('claim@x.com', 60), true,
  're-claim after the window returns true');

-- Coupling regression: a >1-day cooldown must NOT prune a row inside its window.
INSERT INTO public.auth_link_throttle(email, last_sent_at) VALUES ('long@x.com', now() - interval '1 day');
SELECT is(public.claim_login_link_slot('long@x.com', 172800), false,
  'a row 1 day old is not pruned and stays throttled under a 2-day cooldown');

SELECT finish();
ROLLBACK;
