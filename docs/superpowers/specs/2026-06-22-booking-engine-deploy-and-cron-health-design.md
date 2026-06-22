# Restore booking-engine edge functions + cron-health monitoring — design

**Status:** Approved (brainstorming complete)
**Date:** 2026-06-22
**Author:** Stefan Schaal (with Claude)
**Related:** Edge-function deploy reality (memory `edge-functions-not-auto-deployed`); the booking-engine
ignition spec `docs/superpowers/specs/2026-06-21-open-offer-tier-action-design.md`; the Airtable engine
(`airtable-poll` invokes `open-offer-tier`). Supersedes the ad-hoc "just deploy the 5 booking-engine
functions" handoff that motivated this work.

## Context & goal

CLAUDE.md claims *"Edge functions deploy automatically when files in `supabase/functions/<name>/` change.
No manual deploy step."* This is **false** for the live project (`epweartpzwvcasrzyueh`): there is no CI
deploy step, so the deployed function set drifts from the repo. Functions must be pushed via the Supabase
MCP `deploy_edge_function` (proven in PR #124 for `airtable-schema`/`airtable-poll`).

**Empirically verified this session** via `list_edge_functions` + credential-free `OPTIONS` probes
(204 = deployed, 404 `NOT_FOUND` = undeployed, 200 on a repo-absent name = zombie):

- **6 functions are undeployed (404):** `open-offer-tier`, `close-offer-tier`, `expire-offers`,
  `send-offer-digest`, `send-confirmation-digest`, `tier-at-risk-watcher`. Their pg_cron jobs
  (`offer-digest`, `confirmation-digest`, `expire-offers-hourly`, `tier-at-risk-hourly`; see
  `../../../supabase/migrations/20260514290000_pg_cron_schedules.sql`) are **active and firing into 404s**,
  so offer creation, expiry, escalation, the daily digests, and tier-at-risk alerts are all
  non-functional. `close-offer-tier` is **frontend-invoked** ([../../../src/data/bookings.ts](../../../src/data/bookings.ts) `closeOfferTier`)
  so the producer "close tier" action is also broken. `open-offer-tier` is invoked by `airtable-poll`,
  so synced dates never open offers.
- **3 zombie functions are deployed but deleted from the repo:** `notify-signup` and
  `admin-decide-approval` (retired in `../../../supabase/migrations/20260603140000_retire_approval_flow.sql`)
  and `admin-set-role` (replaced by the `set_org_member_role` RPC). No callers; their backing
  tables/RPCs are dropped. Dormant, but stale public surface.
- **The crons have been "succeeding" the whole time.** `cron.job_run_details` records `status=succeeded`
  for these jobs because the command only *queues* `net.http_post`; the real HTTP status (the 404) lands
  in pg_net's `net._http_response`, which has **no request URL** and self-prunes (~6h). Nothing durable
  recorded the failures — which is exactly why the outage went unnoticed.

**Goal:** (1) deploy the 6 functions to restore the booking engine; (2) safely remove the 3 zombies;
(3) build cron-health monitoring (in-app + email alerts + a `/platform` dashboard) so a cron firing into
a non-2xx can never again fail silently.

## Decisions (locked in brainstorming)

1. **One combined spec** covering all three parts (chosen over splitting deploy vs. monitoring).
2. **Monitoring surfacing = alert (in-app notification **+** email to super-admins) **+** a `/platform`
   "System Health" dashboard tab.** (Chosen over alert-only / dashboard-only / in-app-only.)
3. **Persistence = a durable table with current per-job state **plus** a rolling ~30-day failure log.**
   (Chosen over current-state-only and live-reads-only — `net._http_response` prunes in ~6h.)
4. **Zombies = delete after a no-traffic check.** Pull each function's edge logs, confirm zero recent
   invocations, then delete via MCP. (Chosen over immediate delete / leave-and-document.) Source is
   recoverable from git history.
5. **Detection mechanism = dispatch-capture.** Re-schedule every cron so its command records
   `net.http_post`'s returned `request_id` → job name in a table; the watcher joins that to
   `net._http_response` to attribute each HTTP outcome to a specific job. (Chosen over time-correlating
   `cron.job_run_details` to `net._http_response`, which is fragile when several jobs fire at `:00`.)
   Rationale: a 404'd function **cannot report its own absence**, so monitoring must observe from the
   cron (caller) side.

## Part 1 — Deploy the 6 functions

Deploy via MCP `deploy_edge_function` with `files` named relative to the functions root
(`<fn>/index.ts` + each transitive `_shared/*.ts`). `auth.ts` pulls in `deps.ts` + `http.ts`;
`settings.ts`/`identity.ts`/`scheduleChanges.ts`/`http.ts`/`deps.ts` have no sibling `_shared` imports.
All files are ASCII; only external import is `npm:@supabase/supabase-js@2` (no import map needed).
**Byte-exactness:** after each deploy, `get_edge_function` and diff the returned source against the repo;
redeploy on any diff.

| Function | `verify_jwt` | Auth model | `files` |
|---|---|---|---|
| `open-offer-tier` | `true` | `requireRole`/`requireOrgRole`/`isServiceRole` (user + service) | index + `_shared/{http,auth,deps}.ts` |
| `close-offer-tier` | `true` | same | index + `_shared/{http,auth,deps}.ts` |
| `expire-offers` | `false` | `requireCronOrRole` (`X-Cron-Secret`) | index + `_shared/{http,auth,deps}.ts` |
| `tier-at-risk-watcher` | `false` | `requireCronOrRole` | index + `_shared/{http,auth,deps}.ts` |
| `send-offer-digest` | `false` | `requireCronOrRole` | + `_shared/{settings,identity}.ts` |
| `send-confirmation-digest` | `false` | `requireCronOrRole` | + `_shared/{settings,identity,scheduleChanges}.ts` |

`verify_jwt: false` is justified for the cron functions because they implement custom auth
(`X-Cron-Secret` checked constant-time against `app_settings.cron_secret`) and are called by pg_cron
without a JWT. `open-offer-tier`/`close-offer-tier` keep `verify_jwt: true` (every caller — frontend or
`airtable-poll`'s service-role invoke — presents a JWT; they also self-check via `requireOrgRole`).

**Deploy sequence (risk-ordered):**

1. **`open-offer-tier` + `close-offer-tier`** — invoke-only, zero autonomous effect. Deploying just
   fixes the 404s. Immediately restores the producer "close tier" action and the `airtable-poll`→offer
   chain.
2. **`tier-at-risk-watcher`** — its `:05` cron then runs; in-app notifications only, no email.
3. **`expire-offers`** — its `:00` cron then runs `expire_soft_bookings()` (cancels expired offers) **and
   emails producers** a `cast-escalation-requested` for tiers that expired unfilled
   ([../../../supabase/functions/expire-offers/index.ts](../../../supabase/functions/expire-offers/index.ts) line ~109). **Before deploying, quantify the
   first-tick blast radius** (count open/unescalated tiers, expired-suggested bookings) and proceed
   deliberately.
4. **`send-offer-digest` + `send-confirmation-digest`** — send **artist** emails via `deps.sendEmail`
   → `send-transactional-email` (Resend). **Before deploying:** confirm the project's Resend config
   (`RESEND_API_KEY` secret + from-address used by `send-transactional-email`) and note the next gated
   send. Cron windows are **UTC** (`offer-digest` `0 16-19 * * *`, `confirmation-digest` `0 17-20 * * *`);
   the functions gate to the configured Berlin send-hour, so the first real send is the next gated tick.

**Verification per function:** `list_edge_functions` shows `ACTIVE` → `get_edge_function` diff clean →
`curl -X OPTIONS` → 204 → no-secret `POST` → clean 401 (not a 503 boot error). For cron functions,
optionally trigger one real run via `execute_sql` running the job's own `net.http_post(... private.cron_secret() ...)`
and check the affected rows/logs.

## Part 2 — Zombie cleanup

For each of `notify-signup`, `admin-decide-approval`, `admin-set-role`:

1. `get_logs(project_id, service: "edge-function")` and inspect for recent invocations of the slug.
2. If zero recent traffic → delete via MCP (`delete_edge_function` if available, else `supabase functions delete <slug> --project-ref epweartpzwvcasrzyueh`).
3. Record the deletion. Source remains in git history (pre-`20260603140000`) if ever needed.

Also: diff the post-cleanup `list_edge_functions` against the repo's function directory to confirm no
other drift.

## Part 3 — Cron-health monitoring

### Data model (new tables; RLS: super-admin read, service-role write, RESTRICTIVE `org_isolation` N/A — these are platform-global)

- **`public.cron_health_dispatch`** — one row per cron HTTP dispatch.
  `id bigserial pk`, `job_name text not null`, `request_id bigint not null`,
  `dispatched_at timestamptz not null default now()`. Index `(request_id)`, `(job_name, dispatched_at desc)`.
  Written by the cron commands (cron runs as a privileged role → bypasses RLS). Pruned by the watcher
  (keep ~1 day; only needs to outlive the pg_net response window).
- **`public.cron_health_state`** — current health, one row per job (dashboard source + alert idempotency).
  `job_name text pk`, `last_dispatched_at timestamptz`, `last_response_at timestamptz`,
  `last_status_code int`, `last_ok_at timestamptz`, `last_error text`,
  `status text not null check (status in ('healthy','failing','stale','unknown')) default 'unknown'`,
  `consecutive_failures int not null default 0`, `alerted_at timestamptz`, `updated_at timestamptz not null default now()`.
- **`public.cron_health_log`** — rolling failure history (~30 days).
  `id bigserial pk`, `job_name text not null`, `status_code int`, `error text`,
  `observed_at timestamptz not null default now()`. Pruned by the watcher (`observed_at < now() - interval '30 days'`).

All three: `alter table … enable row level security;` policies allow `select` only when
`is_super_admin(auth.uid())`; no anon/authenticated write (writes come from cron / service-role, which
bypass RLS).

### Cron dispatch-capture migration

Re-schedule every job (idempotent `cron.unschedule` + `cron.schedule`, mirroring
`20260514290000_pg_cron_schedules.sql`) so each command captures the dispatched request id, e.g.:

```sql
SELECT cron.schedule('offer-digest', '0 16-19 * * *', $$
  WITH r AS (
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
      headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
      body := '{}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_health_dispatch (job_name, request_id)
  SELECT 'offer-digest', request_id FROM r;
$$);
```

Applies to `offer-digest`, `confirmation-digest`, `expire-offers-hourly`, `tier-at-risk-hourly`,
`airtable-poll`, **and** the watcher's own cron `cron-health-watcher` (below). Schedules and secrets are
unchanged — only the command is wrapped.

### `cron-health-watcher` edge function

New function `supabase/functions/cron-health-watcher/index.ts` modeled on `tier-at-risk-watcher`
(`handle(req, deps)` + `requireCronOrRole`, `verify_jwt: false`). Its own cron `cron-health-watcher`
(every 15 min, `*/15 * * * *`). Each run:

1. For each tracked `job_name`, find the latest `cron_health_dispatch` row and LEFT JOIN
   `net._http_response` on `request_id = net._http_response.id`.
2. Classify: `2xx` → healthy; non-2xx / `timed_out` / `error_msg` → failing; dispatched but no response yet
   → pending (skip, re-check next run); `last_dispatched_at` older than expected interval → stale (job not
   firing at all).
3. Upsert `cron_health_state` (status, codes, timestamps, `consecutive_failures`).
4. **Alert on transition into failure** (`healthy|unknown → failing|stale`) when not already alerted for
   this incident (`alerted_at` is null); `consecutive_failures` is recorded but informational: insert an in-app
   `notifications` row (type `cron_health_alert`) for every `platform_admins` user, and email each via
   `deps.sendEmail({ template_name: 'cron-health-alert', recipient_email, templateData })`. Resolve
   super-admin emails via the service-role `resolve_user_contacts(uuid[])` function (CLAUDE.md). Set
   `alerted_at`. On recovery (`failing → healthy`) insert a "recovered" notification and clear `alerted_at`.
   Idempotent: no re-alert while `status` stays `failing`.
5. Append each failure to `cron_health_log`; prune `cron_health_dispatch` (>1 day) and `cron_health_log`
   (>30 days).

**Self-monitoring (dead-man's switch):** the watcher records its own dispatch, so if the watcher itself
stops (undeployed/erroring) its `cron_health_state` row goes `stale` and surfaces on the dashboard.

### Alert plumbing

- **Notification:** type `cron_health_alert`, `related_entity_type='cron_job'`, `related_entity_id` = a
  stable per-job key. Created server-side (watcher) — satisfies the "no bare client inserts" rule.
- **Email template:** `cron-health-alert` — new React Email template + registration in
  `../../../supabase/functions/_shared/transactional-email-templates/registry.ts`. Variables:
  `job_name`, `status_code`, `error`, `last_ok_at`, `dashboard_url`.

### Dashboard

- **RPC `get_cron_health()`** — `SECURITY DEFINER`, internally guards on `is_super_admin(auth.uid())`
  (raise/`empty` otherwise). Returns per-job: name, `schedule` + `next_run`/`last_run` (from `cron.job` /
  `cron.job_run_details`), `status`, `last_status_code`, `last_ok_at`, `last_error`,
  `consecutive_failures`, and recent `cron_health_log` rows. Reads the `cron`/`net` schemas (not API-exposed)
  via the definer's privileges.
- **UI:** `src/components/platform/SystemHealthTab.tsx` (table of jobs with status pills:
  healthy/failing/stale), data-access `fetchCronHealth(client)` in `../../../src/data/platform.ts`, a
  `useCronHealth` query hook, and a new tab registered in `PlatformPage` (gated by `PlatformRoute`).
  Semantic tokens, shadcn `Badge`/`Table`, React Query `['platform','cron-health']`.

## Testing

- **Watcher** — `supabase/functions/cron-health-watcher/index.{test,di,smoke}.test.ts` (Deno DI, fake
  `Deps`): feed fabricated `cron_health_dispatch` + `net._http_response` rows; assert classification,
  state upsert, **once-per-incident** alert (notification rows + `sendEmail` call counts via the fake),
  recovery clears `alerted_at`, and pruning. Run the whole `supabase/functions/` suite
  (`deno test --allow-all --node-modules-dir=none supabase/functions/`).
- **DB** — pgTAP (CI, `supabase/tests/`): RLS on the 3 tables (super-admin select only; no anon/authenticated
  write) + `get_cron_health()` is super-admin-gated. For the dispatch-capture migration, a PL/pgSQL
  BEGIN…ROLLBACK harness can assert a wrapped command inserts a `cron_health_dispatch` row.
- **Frontend** — vitest: `fetchCronHealth` against `src/test/supabaseFake.ts`; `SystemHealthTab` render
  (loading/healthy/failing) via `renderWithProviders`.

## Risks & sequencing

- **Email timing** (digests, escalation, the new alert) — deploy email-sending functions deliberately;
  the alert email only fires on a real failure transition.
- **Modifying live cron definitions** — single idempotent migration (unschedule-if-exists + reschedule),
  preserving schedules + `private.cron_secret()`; wraps only the command.
- **pg_net mapping assumption** — design assumes `net.http_post(...)`'s returned `bigint` equals
  `net._http_response.id`. **Verify at implementation** (pg_net version on the project) and adjust the join
  if a separate request/response mapping applies.
- **`expire-offers` first-tick cancellations** — quantify before deploying (Part 1 step 3).
- **Watcher must run before pg_net prunes** — 15-min cadence vs. ~6h `net._http_response` retention: ample.
- **Don't let the watcher become the next zombie** — it must be deployed via MCP and verified like Part 1;
  its own `stale` detection is the backstop.

## Out of scope

- Generic monitoring of *all* pg_cron jobs beyond the HTTP-dispatch jobs (the design tracks the jobs we
  wrap; a future generic sweep could read `cron.job` directly).
- Paging/Slack/webhook alerting (only in-app + email this round).
- Retry/auto-redeploy of failed functions (alert only; remediation stays manual).
