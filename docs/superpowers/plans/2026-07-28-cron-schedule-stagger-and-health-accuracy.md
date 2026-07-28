# Cron Schedule Stagger + Health Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the System Health "no HTTP response · timed out" false alarms by giving every cron dispatch its own minute and enough timeout headroom, and make the health watcher report accurately (able to recover itself, counting failures per job run rather than per watcher pass).

**Architecture:** Four changes, three of them SQL. (1) A migration reschedules all seven HTTP-dispatching cron jobs onto distinct minutes and raises `timeout_milliseconds` 30000 → 90000. (2) A migration redefines `cron_health_scan()` so a job's *outcome* comes from its newest **answered** dispatch while *staleness* still comes from its newest dispatch of any kind — this is what lets `cron-health-watcher` observe its own completed prior run instead of skipping itself forever. (3) A new `cron_health_state.last_observation_key` column plus watcher logic so `consecutive_failures` counts distinct observations. (4) Apply to production and verify recovery live.

**Tech Stack:** Postgres 15 + pg_cron + pg_net, pgTAP (`supabase/tests/`), Deno edge functions with DI (`handle(req, deps)` + `makeFakeDeps`), Supabase MCP for migrations and type generation.

## Global Constraints

- **Migrations are applied manually.** Nothing in CI applies them. Use the Supabase MCP `apply_migration` against project `epweartpzwvcasrzyueh`, then `list_migrations` and rename the local file to the version the server actually recorded (it stamps a real timestamp, which drifts from the filename).
- **Never hand-edit** `src/integrations/supabase/types.ts` or `supabase/functions/_shared/database.types.ts`. Regenerate types, then `npm run sync:mirrors`.
- **Never edit an applied migration.** Follow up with a new `CREATE OR REPLACE` / `ALTER` migration instead.
- Edge functions deploy automatically on merge to `main`; the migrations here must be applied to prod **before or with** that merge.
- Tests import the real module. No re-implementing production logic in a test file.
- `any` is banned (`--max-warnings 0`).
- No em-dashes or en-dashes in user-facing copy.
- Commit messages: imperative, lowercase, ≤72 chars.
- Run the **whole** Deno suite after any edge-function change (`deno test --allow-all --node-modules-dir=none supabase/functions/`), not just the one file — `index.test.ts` is not the only suite that touches these handlers.

## Background: the defect being fixed

Verified live on 2026-07-28. All seven dispatch crons collide at `:00` (`*/5`, `*/15` and `0 * * * *` all land there; six jobs during digest hours). The edge runtime serializes the simultaneous cold boots at roughly 10s each, so completions ladder and the fourth slot lands at the 30s `timeout_milliseconds` cliff:

| 13:00:00 batch (all dispatched at 13:00:00.2) | completed |
|---|---|
| airtable-poll | +1.9s |
| cron-health-watcher | +10.3s |
| expire-offers | +20.2s |
| email-health-watcher | +29.3s |

When a run crosses 30s, pg_net abandons it and writes `timed_out`, **even though the function goes on to return HTTP 200**: 10:00 email-health-watcher → 200 at 34.96s; 10:00 airtable-poll → 200 at 43.56s; 12:00 airtable-poll → 200 at 33.30s; 12:00 expire-offers → 200 at 44.17s. Failure rate by collision size: 0/216 at 1–2 concurrent dispatches, 8/76 (10.5%) at 4-way.

Two further bugs found alongside:
- `consecutive_failures` counts watcher passes. An hourly job scanned by a `*/15` watcher re-reads the same dispatch row up to 4 times and increments each pass, so one timeout displays as 3–4 "consecutive failures".
- `cron-health-watcher` can mark itself failing but never healthy. Its own dispatch is always in flight when it runs, so `responded_at === null` hits the `continue` at `index.ts:111` and it is skipped forever. Live proof: `last_ok_at` frozen at 2026-06-24 while edge logs show it returning 200 every 15 minutes.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_cron_stagger_and_timeout.sql` | **Create.** Reschedules all 7 dispatch jobs onto distinct minutes; raises every timeout to 90000ms. |
| `supabase/tests/db/cron_dispatch_timeout.sql` | **Modify.** Existing guard, currently asserts 30000. Retarget to 90000 and cover `email-health-watcher` (which it omits today). |
| `supabase/tests/db/cron_schedule_stagger.sql` | **Create.** Asserts each job's exact schedule and that no two dispatch jobs share a minute field. |
| `supabase/migrations/<ts>_cron_health_scan_answered.sql` | **Create.** Drops and recreates `cron_health_scan()` with the newest-answered-outcome semantics plus a new `answered_at` column. |
| `supabase/tests/rpc/cron_health_rpcs.sql` | **Modify.** Add coverage for the new column and the answered-vs-latest split. |
| `supabase/migrations/<ts>_cron_health_observation_key.sql` | **Create.** Adds `cron_health_state.last_observation_key text`. |
| `supabase/functions/cron-health-watcher/index.ts` | **Modify.** Read `last_observation_key`, count failures per distinct observation, refresh the stale self-monitoring comment. |
| `supabase/functions/cron-health-watcher/index.test.ts` | **Modify.** Add tests for repeat-observation counting and self-recovery. |
| `src/integrations/supabase/types.ts` | **Regenerate.** Picks up `last_observation_key`. |
| `supabase/functions/_shared/database.types.ts` | **Regenerate** via `npm run sync:mirrors`. |

## The new schedule grid

No two HTTP-dispatching jobs share a minute. `email-log-prune` (`30 3 * * *`) is pure SQL, dispatches nothing, and is left alone.

| Job | Old | New | Fires at |
|---|---|---|---|
| expire-offers-hourly | `0 * * * *` | `0 * * * *` (unchanged) | :00 |
| airtable-poll | `*/5 * * * *` | `2-59/5 * * * *` | :02, :07, … :57 |
| offer-digest | `0 16-19 * * *` | `3 16-19 * * *` | :03 |
| confirmation-digest | `0 17-20 * * *` | `4 17-20 * * *` | :04 |
| tier-at-risk-hourly | `5 * * * *` | `5 * * * *` (unchanged) | :05 |
| cron-health-watcher | `*/15 * * * *` | `9-59/15 * * * *` | :09, :24, :39, :54 |
| email-health-watcher | `*/15 * * * *` | `11-59/15 * * * *` | :11, :26, :41, :56 |

The digests keep their existing **hour** fields, so the Berlin-hour gates inside `send-offer-digest` / `send-confirmation-digest` are unaffected. Every `KNOWN_JOBS` max-silence window in `cron-health-watcher/index.ts` still holds: airtable-poll's gap stays 5 min (window 30), the watchers' stay 15 min (window 60), and offer-digest's worst gap is 19:03 → next-day 16:03 = 1260 min (window 1320).

---

### Task 1: Stagger the schedules and raise the dispatch timeout

**Files:**
- Create: `supabase/migrations/20260728140000_cron_stagger_and_timeout.sql`
- Modify: `supabase/tests/db/cron_dispatch_timeout.sql`
- Create: `supabase/tests/db/cron_schedule_stagger.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: seven `cron.job` rows whose `command` matches `timeout_milliseconds\s*:=\s*90000` and whose `schedule` values are the grid above. Later tasks do not depend on these programmatically.

- [ ] **Step 1: Write the failing stagger guard**

Create `supabase/tests/db/cron_schedule_stagger.sql`:

```sql
-- Every HTTP-dispatching cron job must fire on its own minute. When several collide (they all
-- landed on :00 before 2026-07-28) the edge runtime serializes the simultaneous cold boots at
-- roughly 10s each, the later ones cross pg_net's timeout, and healthy 200 runs get recorded as
-- false `timed_out` responses that cron-health-watcher reports as failures. Regression guard for
-- the cron_stagger_and_timeout migration. See memory cron-health-watcher-false-timeouts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- EXISTS(...) rather than a set-returning assertion over a WHERE clause: a missing job row would
-- otherwise return zero rows and be silently SKIPPED, desyncing plan(8) instead of failing.
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='expire-offers-hourly' AND schedule='0 * * * *'),
          'expire-offers-hourly fires at :00');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='airtable-poll' AND schedule='2-59/5 * * * *'),
          'airtable-poll fires at :02 and every 5 min after, never :00');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='offer-digest' AND schedule='3 16-19 * * *'),
          'offer-digest fires at :03 (hour field unchanged, Berlin gate unaffected)');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='confirmation-digest' AND schedule='4 17-20 * * *'),
          'confirmation-digest fires at :04 (hour field unchanged)');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='tier-at-risk-hourly' AND schedule='5 * * * *'),
          'tier-at-risk-hourly fires at :05');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='cron-health-watcher' AND schedule='9-59/15 * * * *'),
          'cron-health-watcher fires at :09/:24/:39/:54');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='email-health-watcher' AND schedule='11-59/15 * * * *'),
          'email-health-watcher fires at :11/:26/:41/:56');

-- Aggregate guard: all seven dispatch jobs must have distinct minute fields. Catches a future
-- edit that reintroduces a collision without touching the per-job assertions above.
SELECT is(
  (SELECT count(DISTINCT split_part(schedule, ' ', 1))::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                     'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher')),
  7,
  'no two dispatch jobs share a minute field'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to confirm it fails**

pgTAP runs without Docker by executing the file body through the Supabase MCP `execute_sql` (it is already wrapped in `BEGIN; … ROLLBACK;`, so it leaves no trace). Paste the file contents as the query against project `epweartpzwvcasrzyueh`.

Expected: 7 `not ok` lines for the per-job schedules (they are still `*/5`, `*/15`, `0 …`) and `not ok` on the distinct-minute count (currently 4 distinct minute fields, not 7).

- [ ] **Step 3: Retarget the existing timeout guard to 90000**

In `supabase/tests/db/cron_dispatch_timeout.sql`, replace the whole file with:

```sql
-- Every cron job that dispatches an edge function via net.http_post MUST set an explicit
-- timeout_milliseconds above the real tail latency of an edge invocation. pg_net's implicit
-- default is 5000ms; a 30000ms ceiling was still under the observed tail (200 responses at
-- 33.3s, 34.9s, 43.6s and 44.2s on 2026-07-28), and every run that crosses the ceiling is
-- recorded as a false `timed_out` that cron-health-watcher reports as `failing` and pages
-- super-admins about. 90s covers a serialized cold boot plus real work while still catching a
-- genuinely hung function. Regression guard for the cron_stagger_and_timeout migration.
-- See memory cron-health-watcher-false-timeouts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- Per-job guards use ok(EXISTS(...)) rather than a set-returning matches() over a WHERE clause:
-- if a job row were ABSENT, a `SELECT matches(...) FROM cron.job WHERE jobname='x'` returns zero
-- rows and the assertion is silently SKIPPED (desyncing plan(8)), instead of failing. EXISTS makes
-- a missing job an explicit failure.
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'airtable-poll' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'airtable-poll dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'offer-digest' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'offer-digest dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'confirmation-digest' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'confirmation-digest dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'expire-offers-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'expire-offers-hourly dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'tier-at-risk-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'tier-at-risk-hourly dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'cron-health-watcher' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'cron-health-watcher dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'email-health-watcher' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'email-health-watcher dispatch sets a 90s timeout'
);

-- Aggregate guard: none of the seven dispatch jobs may fall back to the implicit 5000ms default.
SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                     'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher')
     AND command !~ 'timeout_milliseconds'),
  0,
  'no dispatch job relies on the implicit 5000ms pg_net default'
);

SELECT * FROM finish();
ROLLBACK;
```

Note the plan count moved 7 → 8 and `email-health-watcher` was added; it dispatches via `net.http_post` but the original guard predated it.

- [ ] **Step 4: Run it to confirm it fails**

Execute the file body via MCP `execute_sql`. Expected: 7 `not ok` lines (every job still says 30000).

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20260728140000_cron_stagger_and_timeout.sql`:

```sql
-- Give every HTTP-dispatching cron job its own minute, and raise the pg_net dispatch timeout
-- from 30s to 90s.
--
-- Before this, `*/5` (airtable-poll), `*/15` (cron-health-watcher, email-health-watcher) and
-- `0 * * * *` (expire-offers) all fired at :00, six jobs during digest hours. The edge runtime
-- serializes those simultaneous cold boots at roughly 10s each, so completions ladder (13:00 batch
-- measured 2026-07-28: +1.9s, +10.3s, +20.2s, +29.3s) and the later slots cross pg_net's ceiling.
-- pg_net then records `timed_out` even though the function returns 200 seconds later (observed:
-- 200 at 33.3s, 34.9s, 43.6s, 44.2s), and cron-health-watcher reports those as `failing` and pages
-- super-admins. Failure rate was 0/216 at 1-2 concurrent dispatches vs 8/76 at 4-way.
--
-- Digest hour fields are unchanged, so the Berlin-hour gates inside the digest functions still
-- behave identically. Idempotent (unschedule-if-exists + reschedule); headers, the cron secret and
-- the dispatch-capture INSERT are unchanged. Supersedes 20260624101342_cron_dispatch_timeout.sql
-- and 20260711000837_email_health_watcher_cron.sql.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                    'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('expire-offers-hourly','0 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/expire-offers',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'expire-offers-hourly', request_id FROM r;
$$);

SELECT cron.schedule('airtable-poll','2-59/5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'airtable-poll', request_id FROM r;
$$);

SELECT cron.schedule('offer-digest','3 16-19 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'offer-digest', request_id FROM r;
$$);

SELECT cron.schedule('confirmation-digest','4 17-20 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-confirmation-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'confirmation-digest', request_id FROM r;
$$);

SELECT cron.schedule('tier-at-risk-hourly','5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'tier-at-risk-hourly', request_id FROM r;
$$);

SELECT cron.schedule('cron-health-watcher','9-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/cron-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'cron-health-watcher', request_id FROM r;
$$);

SELECT cron.schedule('email-health-watcher','11-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/email-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'email-health-watcher', request_id FROM r;
$$);
```

- [ ] **Step 6: Apply the migration and rerun both guards**

Apply with MCP `apply_migration` (project `epweartpzwvcasrzyueh`, name `cron_stagger_and_timeout`). Then run `list_migrations` and rename the local file to the version string the server recorded.

Rerun both pgTAP files via `execute_sql`.

Expected: `cron_schedule_stagger.sql` → 8/8 ok; `cron_dispatch_timeout.sql` → 8/8 ok.

- [ ] **Step 7: Confirm the live schedule grid**

```sql
SELECT jobname, schedule,
       (command ~ 'timeout_milliseconds\s*:=\s*90000') AS has_90s
FROM cron.job ORDER BY jobname;
```

Expected: seven dispatch jobs with the grid schedules and `has_90s = true`; `email-log-prune` untouched at `30 3 * * *`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_cron_stagger_and_timeout.sql supabase/tests/db/cron_dispatch_timeout.sql supabase/tests/db/cron_schedule_stagger.sql
git commit -m "fix(cron): stagger dispatch minutes and raise pg_net timeout to 90s"
```

---

### Task 2: Classify job outcome from the newest *answered* dispatch

This is the fix that lets `cron-health-watcher` recover itself. Staleness keeps reading the newest dispatch of any kind; the HTTP outcome now comes from the newest dispatch that actually has a response row.

The change is deliberately **backward compatible with the currently deployed watcher**: all seven existing output columns keep their names, and `dispatched_at` keeps its exact old meaning (newest dispatch). So it is safe to apply this migration to prod before the Task 3 function deploy lands.

**Files:**
- Create: `supabase/migrations/20260728141000_cron_health_scan_answered.sql`
- Modify: `supabase/tests/rpc/cron_health_rpcs.sql`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `public.cron_health_scan()` returning `(job_name text, request_id bigint, dispatched_at timestamptz, answered_at timestamptz, status_code int, timed_out boolean, error_msg text, responded_at timestamptz)`. `dispatched_at` = newest dispatch of any kind. `request_id`, `answered_at`, `status_code`, `timed_out`, `error_msg`, `responded_at` all describe the newest **answered** dispatch and are NULL when the job has none. Task 3's `ScanRow` type mirrors this exactly.

- [ ] **Step 1: Write the failing RPC tests**

Append these to `supabase/tests/rpc/cron_health_rpcs.sql`, immediately **before** the closing `SELECT * FROM finish();`, and bump the `plan(4)` on line 5 to `plan(7)`:

```sql
-- cron_health_scan must expose answered_at: the dispatch the outcome came from, which may be
-- older than the newest dispatch.
SELECT has_column('public', 'cron_health_scan', 'answered_at', 'cron_health_scan returns answered_at')
  FROM (SELECT 1) _ WHERE false;  -- placeholder removed below
```

That helper does not exist for set-returning functions, so use behavioural assertions instead. Replace the block above with:

```sql
-- A job whose newest dispatch is still in flight must still report the outcome of its previous,
-- answered dispatch. This is what lets cron-health-watcher recover itself: its own dispatch is
-- ALWAYS in flight while it runs, so keying the outcome to the newest dispatch left it permanently
-- stuck "failing" (last_ok_at was frozen at 2026-06-24 in prod).
SET session_replication_role = replica;
DELETE FROM public.cron_health_dispatch;
INSERT INTO net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
VALUES (900001, 200, 'application/json', '{}'::jsonb, '{"ok":true}', false, NULL, now() - interval '20 minutes');
INSERT INTO public.cron_health_dispatch (job_name, request_id, dispatched_at)
VALUES ('cron-health-watcher', 900001, now() - interval '20 minutes'),  -- answered
       ('cron-health-watcher', 900002, now());                          -- in flight, no response row
SET session_replication_role = origin;

SELECT is(
  (SELECT status_code FROM public.cron_health_scan() WHERE job_name = 'cron-health-watcher'),
  200,
  'outcome comes from the newest ANSWERED dispatch, not the in-flight one'
);
SELECT ok(
  (SELECT dispatched_at FROM public.cron_health_scan() WHERE job_name = 'cron-health-watcher')
    > (SELECT answered_at FROM public.cron_health_scan() WHERE job_name = 'cron-health-watcher'),
  'dispatched_at tracks the newest dispatch while answered_at tracks the answered one'
);

-- A job with dispatches but no answered one at all reports a NULL outcome, so the watcher skips it
-- rather than inventing a failure.
SET session_replication_role = replica;
DELETE FROM public.cron_health_dispatch;
INSERT INTO public.cron_health_dispatch (job_name, request_id, dispatched_at)
VALUES ('offer-digest', 900003, now());
SET session_replication_role = origin;

SELECT ok(
  (SELECT responded_at IS NULL AND status_code IS NULL AND answered_at IS NULL
   FROM public.cron_health_scan() WHERE job_name = 'offer-digest'),
  'a job with only in-flight dispatches reports a null outcome'
);
```

Note the `DELETE FROM public.cron_health_dispatch` before each block: in CI the real dispatch crons can fire mid-test. Everything is inside the file's existing `BEGIN; … ROLLBACK;`.

- [ ] **Step 2: Run it to confirm it fails**

Execute the file body via MCP `execute_sql`.

Expected: the `answered_at` assertions fail with `column "answered_at" does not exist` (the current function returns only seven columns).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260728141000_cron_health_scan_answered.sql`:

```sql
-- Split "which dispatch is newest" from "which dispatch actually answered".
--
-- cron_health_scan previously returned only the newest dispatch per job and LEFT JOINed its
-- response. cron-health-watcher therefore skipped any job whose newest dispatch was still in
-- flight -- which for the watcher itself is ALWAYS true, because its own dispatch is in flight for
-- the whole time it runs. It could still mark itself failing (pg_net abandons its request at the
-- timeout and writes timed_out, which the still-running watcher then reads), but it could never
-- mark itself healthy again. In prod its last_ok_at was frozen at 2026-06-24 while the edge logs
-- showed it returning 200 every 15 minutes.
--
-- Now: `dispatched_at` is still the newest dispatch of any kind (the staleness source, unchanged
-- meaning), while the outcome columns come from the newest dispatch that has a response row, and
-- `answered_at` says which dispatch that was. All previously returned column names and meanings are
-- preserved, so an older deployed watcher keeps working against this function.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a column changes the return type, which
-- CREATE OR REPLACE cannot do ("cannot change return type of existing function").
DROP FUNCTION IF EXISTS public.cron_health_scan();

CREATE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz, answered_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (d.job_name) d.job_name, d.dispatched_at
    FROM public.cron_health_dispatch d
    ORDER BY d.job_name, d.dispatched_at DESC
  ),
  answered AS (
    SELECT DISTINCT ON (d.job_name)
      d.job_name, d.request_id, d.dispatched_at,
      r.status_code, r.timed_out, r.error_msg, r.created AS responded_at
    FROM public.cron_health_dispatch d
    JOIN net._http_response r ON r.id = d.request_id
    ORDER BY d.job_name, d.dispatched_at DESC
  )
  SELECT l.job_name, a.request_id, l.dispatched_at, a.dispatched_at,
         a.status_code, a.timed_out, a.error_msg, a.responded_at
  FROM latest l
  LEFT JOIN answered a ON a.job_name = l.job_name;
$$;
REVOKE ALL ON FUNCTION public.cron_health_scan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health_scan() TO service_role;
```

- [ ] **Step 4: Apply and rerun**

Apply with MCP `apply_migration` (name `cron_health_scan_answered`), then `list_migrations` and rename the local file to the recorded version. Rerun `supabase/tests/rpc/cron_health_rpcs.sql` via `execute_sql`.

Expected: 7/7 ok.

- [ ] **Step 5: Confirm against live data**

```sql
SELECT job_name, dispatched_at, answered_at, status_code, timed_out
FROM public.cron_health_scan() ORDER BY job_name;
```

Expected: every row has a non-null `dispatched_at`; jobs with a completed dispatch in the pg_net retention window (`pg_net.ttl` is 6h) carry a `status_code`, and `answered_at <= dispatched_at`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_cron_health_scan_answered.sql supabase/tests/rpc/cron_health_rpcs.sql
git commit -m "fix(cron): read job outcome from the newest answered dispatch"
```

---

### Task 3: Count consecutive failures per observation, not per watcher pass

**Files:**
- Create: `supabase/migrations/20260728142000_cron_health_observation_key.sql`
- Modify: `supabase/functions/cron-health-watcher/index.ts`
- Modify: `supabase/functions/cron-health-watcher/index.test.ts`
- Regenerate: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Consumes: `cron_health_scan()`'s `answered_at` column from Task 2.
- Produces: `cron_health_state.last_observation_key text` (nullable). Key format is `req:<request_id>` for response-derived classifications and `stale:<dispatched_at ISO>` for staleness. Nothing downstream reads it except the watcher itself; `get_cron_health()` is unchanged, so the dashboard needs no update.

- [ ] **Step 1: Write the failing watcher tests**

Append to `supabase/functions/cron-health-watcher/index.test.ts`:

```ts
Deno.test("cron-health-watcher: re-reading the SAME dispatch does not re-increment consecutive_failures", async () => {
  // An hourly job scanned by a */15 watcher re-reads one dispatch row up to 4 times. Counting
  // watcher passes turned a single timeout into "3 consecutive failures" in prod.
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "expire-offers-hourly", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 1, last_observation_key: "req:42" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "expire-offers-hourly", request_id: 42, dispatched_at: recent, answered_at: recent, status_code: null, timed_out: true, error_msg: null, responded_at: recent }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { consecutive_failures?: number; last_observation_key?: string };
  assertEquals(payload.consecutive_failures, 1);
  assertEquals(payload.last_observation_key, "req:42");
});

Deno.test("cron-health-watcher: a NEW failed dispatch does increment consecutive_failures", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "expire-offers-hourly", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 1, last_observation_key: "req:42" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "expire-offers-hourly", request_id: 43, dispatched_at: recent, answered_at: recent, status_code: null, timed_out: true, error_msg: null, responded_at: recent }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { consecutive_failures?: number; last_observation_key?: string };
  assertEquals(payload.consecutive_failures, 2);
  assertEquals(payload.last_observation_key, "req:43");
});

Deno.test("cron-health-watcher: recovers itself from a previous answered dispatch while its own is in flight", async () => {
  // The watcher's own dispatch is in flight for its whole run, so the scan reports a newer
  // dispatched_at than answered_at. It must still classify from the answered 200 and recover,
  // rather than skipping itself forever (prod last_ok_at was stuck at 2026-06-24).
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "cron-health-watcher", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 5, last_observation_key: "req:98" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "cron-health-watcher", request_id: 99, dispatched_at: recent, answered_at: "2026-06-23T09:45:00.000Z", status_code: 200, timed_out: false, error_msg: null, responded_at: "2026-06-23T09:45:10.000Z" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; consecutive_failures?: number; alerted_at?: string | null };
  assertEquals(payload.status, "healthy");
  assertEquals(payload.consecutive_failures, 0);
  assertEquals(payload.alerted_at, null);
  assertEquals((await res.json()).recovered, 1);
});

Deno.test("cron-health-watcher: a repeated STALE observation does not re-increment either", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "stale", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 2, last_observation_key: `stale:${stale}` }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: null, dispatched_at: stale, answered_at: null, status_code: null, timed_out: null, error_msg: null, responded_at: null }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(((upsert?.args?.[0]) as { consecutive_failures?: number }).consecutive_failures, 2);
});
```

Also update the pre-existing test `"consecutive_failures increments from the previous value"` so its `cron_health_state` fixture carries `last_observation_key: "req:3"` while the scan row uses `request_id: 4` — a genuinely new observation, so it still expects `4`. Without that the fixture's `undefined` key would compare unequal to `req:4` and the test would coincidentally still pass, hiding the behaviour.

- [ ] **Step 2: Run the whole Deno suite to confirm the new tests fail**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/cron-health-watcher/
```

Expected: the four new tests fail. `last_observation_key` is `undefined` in the upsert payload and the self-recovery test reports `recovered: 0`.

- [ ] **Step 3: Write the column migration**

Create `supabase/migrations/20260728142000_cron_health_observation_key.sql`:

```sql
-- Identity of the last observation cron-health-watcher classified for a job, so
-- consecutive_failures counts distinct failed OBSERVATIONS rather than watcher passes.
-- expire-offers dispatches hourly but the watcher scans every 15 minutes, so it re-read the same
-- dispatch row up to 4 times and incremented every pass: one timeout displayed as "3 consecutive
-- failures" in prod on 2026-07-28.
-- Format: 'req:<request_id>' when classified from a response, 'stale:<dispatched_at>' when
-- classified as stale. Nullable: pre-existing rows have no key and simply count their next
-- observation as new.
ALTER TABLE public.cron_health_state
  ADD COLUMN IF NOT EXISTS last_observation_key text;

COMMENT ON COLUMN public.cron_health_state.last_observation_key IS
  'Identity of the last classified observation (req:<request_id> or stale:<dispatched_at>). Gates consecutive_failures so re-reading one dispatch across several watcher passes counts once.';
```

- [ ] **Step 4: Apply the migration and regenerate types**

Apply with MCP `apply_migration` (name `cron_health_observation_key`), then `list_migrations` and rename the local file to match. Regenerate types with MCP `generate_typescript_types` and write the result to `src/integrations/supabase/types.ts`, then:

```bash
npm run sync:mirrors
```

- [ ] **Step 5: Update the watcher**

In `supabase/functions/cron-health-watcher/index.ts`:

Replace the `SELF-MONITORING CAVEAT` paragraph in the header comment (lines 22-26) with:

```
 * SELF-MONITORING: the watcher's own dispatch is in flight for the whole time it runs, so it can
 * never see a response to the request that invoked it. cron_health_scan therefore reports the
 * outcome of the newest ANSWERED dispatch (answered_at) while dispatched_at still tracks the newest
 * dispatch of any kind, which is what lets the watcher classify itself from its previous completed
 * run. Liveness is still observed externally: the dashboard surfaces last_run_at from
 * cron.job_run_details, and if that ages the watcher itself has stopped.
```

Update the two row types:

```ts
type ScanRow = {
  job_name: string;
  request_id: number | null;
  dispatched_at: string;      // newest dispatch of any kind — the staleness source
  answered_at: string | null; // dispatch the outcome below came from; may be older
  status_code: number | null;
  timed_out: boolean | null;
  error_msg: string | null;
  responded_at: string | null;
};
type StateRow = {
  job_name: string;
  status: string;
  alerted_at: string | null;
  last_ok_at: string | null;
  consecutive_failures: number;
  last_observation_key: string | null;
};
```

Add the column to the state read (currently line 82):

```ts
  const { data: stateData, error: stateErr } = await admin
    .from("cron_health_state").select("job_name, status, alerted_at, last_ok_at, consecutive_failures, last_observation_key");
```

Immediately after the `const prev = prevByJob.get(jobName);` / `prevStatus` / `failing` / `wasFailing` block, insert:

```ts
    // consecutive_failures counts distinct failed OBSERVATIONS, not watcher passes. An hourly job
    // scanned by a */15 watcher re-reads the same dispatch row up to 4 times; incrementing on each
    // pass turned one timeout into "3 consecutive failures".
    const observationKey = status === "stale"
      ? `stale:${row.dispatched_at}`
      : `req:${row.request_id}`;
    const repeatObservation = prev?.last_observation_key === observationKey;
```

Then in the upsert payload, replace the `consecutive_failures` line and add the key:

```ts
      consecutive_failures: failing
        ? (repeatObservation ? (prev?.consecutive_failures ?? 0) : (prev?.consecutive_failures ?? 0) + 1)
        : 0,
      last_observation_key: observationKey,
```

- [ ] **Step 6: Run the whole Deno suite**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

Expected: all tests pass, including the four new ones and the pre-existing ten.

- [ ] **Step 7: Lint and typecheck the frontend (types.ts changed)**

```bash
npm run lint && npx tsc --noEmit && npx vitest run
```

Expected: zero warnings, no type errors, all suites green.

- [ ] **Step 8: Verify the mirror is in sync**

```bash
npm run sync:mirrors:check
```

Expected: no drift.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/*_cron_health_observation_key.sql supabase/functions/cron-health-watcher/ src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "fix(cron): count consecutive failures per observation not per pass"
```

---

### Task 4: Deploy and verify recovery in production

**Files:** none changed. This task is verification.

**Interfaces:**
- Consumes: all three migrations applied (Tasks 1-3) and the watcher deployed.
- Produces: evidence that the false alarms have stopped.

- [ ] **Step 1: Confirm all three migrations are applied**

Run MCP `list_migrations`. Expected: `cron_stagger_and_timeout`, `cron_health_scan_answered`, `cron_health_observation_key` all present, and each local filename matches its recorded version.

- [ ] **Step 2: Deploy the watcher**

Merging to `main` deploys it via `.github/workflows/deploy-functions.yml`. To verify before merge, deploy off-cycle with MCP `deploy_edge_function` for `cron-health-watcher`.

- [ ] **Step 3: Wait for one watcher pass and confirm self-recovery**

The watcher now runs at :09/:24/:39/:54. After the first pass following deployment:

```sql
SELECT job_name, status, consecutive_failures, last_ok_at, last_error, last_observation_key, updated_at
FROM public.cron_health_state ORDER BY job_name;
```

Expected: `cron-health-watcher` is `healthy` with `consecutive_failures = 0` and a **fresh** `last_ok_at` (it was frozen at 2026-06-24). `expire-offers-hourly` is `healthy`. Every row has a non-null `last_observation_key`.

- [ ] **Step 4: Confirm dispatches no longer collide**

```sql
SELECT date_trunc('second', dispatched_at) AS at, count(*) AS jobs_in_same_second,
       string_agg(job_name, ', ' ORDER BY job_name) AS jobs
FROM public.cron_health_dispatch
WHERE dispatched_at > now() - interval '1 hour'
GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;
```

Expected: **zero rows**. Every dispatch now has its own second.

- [ ] **Step 5: Confirm no new timeouts**

```sql
SELECT d.job_name, count(*) AS dispatches,
       count(*) FILTER (WHERE r.timed_out) AS timeouts,
       count(*) FILTER (WHERE r.status_code >= 500) AS http_5xx,
       max(r.status_code) AS max_status
FROM public.cron_health_dispatch d
LEFT JOIN net._http_response r ON r.id = d.request_id
WHERE d.dispatched_at > now() - interval '1 hour'
GROUP BY d.job_name ORDER BY d.job_name;
```

Expected: `timeouts = 0` and `http_5xx = 0` for every job.

- [ ] **Step 6: Confirm the failure log stops growing**

```sql
SELECT job_name, status_code, error, observed_at
FROM public.cron_health_log ORDER BY observed_at DESC LIMIT 10;
```

Expected: no new rows dated after the deployment.

- [ ] **Step 7: Update the changelog**

`public/changelog.md` gets a newest-first block. This is an internal reliability fix with no customer-facing surface (System Health is a super-admin console, which the changelog rules exclude), so **add nothing** unless the same release carries user-facing work. Record the decision in the PR description instead.

- [ ] **Step 8: Open the PR**

```bash
git push -u origin claude/jobs-http-timeout-6e4f25
gh pr create --title "fix(cron): stop false scheduled-job timeout alarms" --body "$(cat <<'EOF'
## Summary

Scheduled jobs were reporting "no HTTP response · timed out" in System Health while actually succeeding. All seven dispatch crons fired at `:00`; the edge runtime serializes the simultaneous cold boots at roughly 10s each, so later slots crossed pg_net's 30s ceiling and were recorded as timeouts even though the functions returned 200 (measured: 200 at 33.3s, 34.9s, 43.6s, 44.2s). Failure rate was 0/216 at 1-2 concurrent dispatches vs 8/76 at 4-way.

## Changes

- Stagger every dispatch cron onto its own minute; raise `timeout_milliseconds` 30s to 90s.
- `cron_health_scan()` now classifies from the newest **answered** dispatch while staleness still uses the newest dispatch. This fixes `cron-health-watcher` being permanently stuck "failing": its own dispatch is always in flight while it runs, so it could mark itself failing but never healthy (`last_ok_at` was frozen at 2026-06-24).
- `consecutive_failures` counts distinct observations via a new `cron_health_state.last_observation_key`, instead of counting watcher passes (an hourly job scanned every 15 min inflated one timeout into 3-4).

## Verification

All three migrations applied to prod. pgTAP guards for the schedule grid and the 90s timeout; new Deno tests for observation counting and self-recovery. Post-deploy: zero colliding dispatches, zero timeouts, watcher recovered to healthy.

No changelog entry: System Health is a super-admin console, which the changelog rules exclude.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** All four parts the user approved are covered: stagger (Task 1), 90s timeout (Task 1), watcher self-recovery (Task 2 + Task 3 Step 5), `consecutive_failures` per observation (Task 3). Task 4 verifies each in production.

**Ordering safety.** Task 2's migration is backward compatible with the deployed watcher — every pre-existing output column keeps its name, and `dispatched_at` keeps its exact old meaning — so applying migrations ahead of the function deploy cannot produce false "stale" alerts. Task 3's column is nullable, so the deployed watcher (which does not select it) is unaffected until the new one ships.

**Type consistency.** `ScanRow` in Task 3 matches the `RETURNS TABLE` signature in Task 2 field for field, including `request_id` being nullable (a job with only in-flight dispatches has no answered row). `StateRow.last_observation_key` matches the migration's `text` column and the `req:` / `stale:` formats used in both the watcher and the tests.

**Known limitation, deliberately not fixed here.** `pg_net.ttl` is 6 hours while `cron_health_dispatch` is pruned at 1 day, so a job that dispatches less often than every 6 hours (the two digests) loses its response row and reports a null outcome until its next dispatch. That is pre-existing behaviour, it fails safe (the watcher skips rather than inventing a failure), and changing it means retaining outcomes in our own table. Out of scope.
