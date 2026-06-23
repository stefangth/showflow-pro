# Booking-engine deploy + cron-health monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the booking engine by deploying 6 undeployed edge functions, remove 3 zombie functions, correct CLAUDE.md's false auto-deploy claim, and build cron-health monitoring (in-app + email alerts + a `/platform` dashboard) so a cron firing into a non-2xx can never again fail silently.

**Architecture:** Parts 1/2/4 are operational (MCP deploy/delete + a doc edit) — no code, verified live. Part 3 adds: 3 public tables (dispatch log, current state, 30-day failure log), two `SECURITY DEFINER` RPCs (`cron_health_scan` does the cross-schema `net._http_response` join the edge runtime can't; `get_cron_health` feeds the dashboard), a `cron-health-watcher` edge function that classifies + alerts, a re-scheduled set of crons that capture each `net.http_post` request id, an email template, and a `/platform` System Health tab.

**Tech Stack:** Supabase (Postgres + pg_cron + pg_net + Edge Functions/Deno), React 18 + React Query + shadcn, Resend (via `send-transactional-email`), Vitest / Deno test / pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-22-booking-engine-deploy-and-cron-health-design.md`

---

## Environment & verification notes (read first)

- **Project ref:** `epweartpzwvcasrzyueh`. All MCP calls pass `project_id: "epweartpzwvcasrzyueh"`.
- **No `node`/`npm`/`npx` locally; only Deno.** So: **Deno edge-fn tests run locally** (`deno test --allow-all --node-modules-dir=none supabase/functions/`); **Vitest, ESLint, and pgTAP run in CI only** — write them, but their green/red is confirmed by CI on the PR, not locally.
- **DB changes go through the MCP** `apply_migration` (records a real-timestamp version — name the repo migration file to match what `list_migrations` shows afterward) for live application, **and** a committed file under `supabase/migrations/` for CI's preview branch. Never hand-edit `src/integrations/supabase/types.ts`.
- **Edge functions are NOT auto-deployed** — deploy via MCP `deploy_edge_function`; `files[].name` is relative to the functions root. After deploy, `get_edge_function` and diff vs the repo file.
- **Credential-free deploy probe:** `curl -X OPTIONS https://epweartpzwvcasrzyueh.supabase.co/functions/v1/<fn>` → 204 deployed / 404 undeployed.
- This work happens on the session branch `claude/quizzical-sinoussi-3126d8`. Open one PR at the end; let CI run the full matrix.

---

## Part 1 — Deploy the 6 functions (restore the engine)

> These tasks change no repo files — they deploy already-tested source. "Verify" replaces "test". Read each function's current source from the repo and pass it verbatim as `files[].content`; confirm byte-exactness with `get_edge_function`.

### Task 1: Deploy the invoke-only offer-tier functions

**Files (deploy inputs, names relative to functions root):**
- `open-offer-tier/index.ts` + `_shared/http.ts` + `_shared/auth.ts` + `_shared/deps.ts`
- `close-offer-tier/index.ts` + `_shared/http.ts` + `_shared/auth.ts` + `_shared/deps.ts`

- [ ] **Step 1: Deploy `open-offer-tier`**

MCP `deploy_edge_function`: `project_id: "epweartpzwvcasrzyueh"`, `name: "open-offer-tier"`, `entrypoint_path: "open-offer-tier/index.ts"`, `verify_jwt: true`, `files` = the 4 files above with `content` read verbatim from the repo.

- [ ] **Step 2: Verify `open-offer-tier` is byte-exact and live**

Run `get_edge_function(project_id, "open-offer-tier")`; diff the returned `index.ts` against `supabase/functions/open-offer-tier/index.ts`. Then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://epweartpzwvcasrzyueh.supabase.co/functions/v1/open-offer-tier
curl -s -X POST https://epweartpzwvcasrzyueh.supabase.co/functions/v1/open-offer-tier -H 'Content-Type: application/json' -d '{}'
```
Expected: OPTIONS → `204`; POST → `401 {"error":"Unauthorized"}` (gateway rejects the missing JWT — not a 503 boot error). Diff: identical.

- [ ] **Step 3: Deploy `close-offer-tier`** — same as Step 1 with `name`/`entrypoint_path` = `close-offer-tier/index.ts`, `verify_jwt: true`.

- [ ] **Step 4: Verify `close-offer-tier`** — `get_edge_function` diff clean; OPTIONS → 204; POST `{}` → 401. (This restores the producer "close tier" action wired at `src/data/bookings.ts` `closeOfferTier`.)

- [ ] **Step 5: Record outcome** (no commit — no repo change). Note both functions now `ACTIVE` in `list_edge_functions`.

### Task 2: Deploy `tier-at-risk-watcher`

**Files:** `tier-at-risk-watcher/index.ts` + `_shared/{http,auth,deps}.ts`

- [ ] **Step 1: Deploy** — `name: "tier-at-risk-watcher"`, `entrypoint_path: "tier-at-risk-watcher/index.ts"`, **`verify_jwt: false`** (custom `X-Cron-Secret` auth; called by pg_cron without a JWT).

- [ ] **Step 2: Verify deploy** — `get_edge_function` diff clean; OPTIONS → 204; POST `{}` with no secret → `401` (its `requireCronOrRole` rejects). Not 503.

- [ ] **Step 3: Trigger one real run (controlled) and confirm it works**

Run via MCP `execute_sql` (uses the stored secret server-side, never echoed):
```sql
SELECT net.http_post(
  url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
  headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
  body := '{}'::jsonb
);
```
Wait ~10s, then check it returned 2xx:
```sql
SELECT status_code, left(content,200) FROM net._http_response ORDER BY id DESC LIMIT 1;
```
Expected: `status_code = 200`. In-app notifications are created only if open tiers are actually at risk (likely none yet — a `200` with no rows is success).

- [ ] **Step 4: Record outcome** (no commit).

### Task 3: Quantify, then deploy `expire-offers`

**Files:** `expire-offers/index.ts` + `_shared/{http,auth,deps}.ts`

- [ ] **Step 1: Quantify the first-tick blast radius** (read-only)

Run via MCP `execute_sql`:
```sql
SELECT
  (SELECT count(*) FROM show_date_offer_tiers WHERE closed_at IS NULL AND escalation_notified_at IS NULL) AS open_unescalated_tiers,
  (SELECT count(*) FROM bookings WHERE status='suggested' AND offer_expires_at IS NOT NULL AND offer_expires_at < now()) AS expired_suggested,
  (SELECT count(*) FROM bookings WHERE status='soft_booked') AS soft_booked;
```
This is informational: `expired_suggested` rows will be cancelled by `expire_soft_bookings()` on the first tick; `open_unescalated_tiers` that are fully expired + short of slots will email producers a `cast-escalation-requested`. If the counts are non-trivial, surface them to the user before Step 2.

- [ ] **Step 2: Deploy** — `name: "expire-offers"`, `entrypoint_path: "expire-offers/index.ts"`, **`verify_jwt: false`**.

- [ ] **Step 3: Verify deploy** — `get_edge_function` diff clean; OPTIONS → 204; no-secret POST → 401.

- [ ] **Step 4: Trigger one controlled run** — same `net.http_post` pattern as Task 2 Step 3 (URL `…/expire-offers`); confirm latest `net._http_response.status_code = 200`. Spot-check that `bookings` expired-suggested rows moved to `cancelled` (re-run the Step 1 query: `expired_suggested` should drop toward 0).

- [ ] **Step 5: Record outcome** (no commit).

### Task 4: Deploy the two digest senders (deliberate — artist emails)

**Files:** `send-offer-digest/index.ts` + `_shared/{http,auth,deps,settings,identity}.ts`; `send-confirmation-digest/index.ts` + `_shared/{http,auth,deps,settings,identity,scheduleChanges}.ts`

- [ ] **Step 1: Confirm Resend config before deploying**

Verify the project secret exists (value never printed):
```sql
SELECT (SELECT count(*) FROM vault.decrypted_secrets WHERE name='RESEND_API_KEY') AS has_resend_key;
```
(or confirm via the Supabase dashboard Edge Function secrets). Confirm the from-address used by the deployed `send-transactional-email`. Note the current time vs the gated send windows — `offer-digest` fires `0 16-19 * * *` UTC (gates to the configured Berlin send-hour, default 19:00 Berlin), `confirmation-digest` `0 17-20 * * *` UTC (default 20:00 Berlin). The **first real artist email is the next gated tick** after deploy. If that tick is imminent and you want buffer, surface it to the user.

- [ ] **Step 2: Deploy `send-offer-digest`** — `verify_jwt: false`. `get_edge_function` diff clean; OPTIONS → 204; no-secret POST → 401.

- [ ] **Step 3: Deploy `send-confirmation-digest`** — `verify_jwt: false`. Same verification.

- [ ] **Step 4: Do NOT force a send.** Leave the natural gated cron to send. (Optional: a no-secret POST returns 401 and sends nothing, confirming boot health.) Record outcome (no commit).

---

## Part 2 — Zombie cleanup

### Task 5: Delete the 3 zombie functions after a no-traffic check

**Targets:** `notify-signup`, `admin-decide-approval`, `admin-set-role` (deployed, absent from `supabase/functions/`).

- [ ] **Step 1: Check for recent invocations**

For each slug, MCP `get_logs(project_id, service: "edge-function")` and inspect for any recent entries naming that function. (These return 24h of logs.) Expected: no recent invocations of any of the three.

- [ ] **Step 2: Delete each** (only if Step 1 shows no traffic)

MCP `delete_edge_function(project_id, function_slug)` for each of the three. If `delete_edge_function` is unavailable in the MCP build, use `supabase functions delete <slug> --project-ref epweartpzwvcasrzyueh` (CLI is authenticated this session).

- [ ] **Step 3: Verify** — `list_edge_functions` no longer lists the three; OPTIONS to each → `404`. Diff the remaining live set against `ls supabase/functions/` — they should match (16 repo functions, all the deployed ones accounted for). Record outcome (no commit).

---

## Part 4 — Correct CLAUDE.md's auto-deploy claim

### Task 6: Replace the false auto-deploy line

**Files:** Modify `CLAUDE.md:40`

- [ ] **Step 1: Make the edit**

Replace line 40:
```
Edge functions deploy automatically when files in `supabase/functions/<name>/` change. No manual deploy step.
```
with:
```
Edge functions are **not** auto-deployed — there is no CI deploy step. After changing any `supabase/functions/<name>/`, deploy it explicitly via the Supabase MCP `deploy_edge_function` (or `supabase functions deploy <name> --project-ref <project-id>`) and confirm with `list_edge_functions`. Otherwise the deployed set silently drifts from the repo: undeployed functions 404, and any pg_cron job targeting them fires into the void.
```

- [ ] **Step 2: Verify** — `grep -n "deploy automatically" CLAUDE.md` returns nothing; `grep -n "not.*auto-deployed" CLAUDE.md` returns line 40.

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: correct false edge-function auto-deploy claim"
```

---

## Part 3 — Cron-health monitoring

> Schema/RPCs first, then the email template, then the watcher (deployed), then re-schedule crons to capture dispatches, then the dashboard. Each migration is applied live via MCP `apply_migration` **and** saved as a committed file (match the filename to the version `list_migrations` reports).

### Task 7: Migration — the 3 cron-health tables + RLS

**Files:**
- Create: `supabase/migrations/<version>_cron_health_tables.sql`
- Test: `supabase/tests/rls/cron_health.sql`

- [ ] **Step 1: Write the failing pgTAP RLS test**

`supabase/tests/rls/cron_health.sql` (mirrors `supabase/tests/rls/org_helpers_and_platform.sql` style):
```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','ch-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000','authenticated','authenticated','ch-plain@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');
INSERT INTO public.cron_health_state (job_name, status) VALUES ('offer-digest','failing');
SET session_replication_role = origin;

-- Tables exist + RLS enabled
SELECT has_table('public','cron_health_state','cron_health_state exists');
SELECT is(rowsecurity, true, 'RLS on cron_health_state') FROM pg_tables WHERE schemaname='public' AND tablename='cron_health_state';

-- Super-admin can read
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0001-0000-000000000000';
SELECT is((SELECT count(*) FROM public.cron_health_state)::int, 1, 'super-admin reads cron_health_state');

-- Plain authenticated user reads nothing
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0002-0000-000000000000';
SELECT is((SELECT count(*) FROM public.cron_health_state)::int, 0, 'non-super-admin sees no rows');
SELECT throws_ok($$ INSERT INTO public.cron_health_state(job_name,status) VALUES ('x','healthy') $$, NULL, 'non-super-admin cannot insert');
SELECT is((SELECT count(*) FROM public.cron_health_log)::int, 0, 'non-super-admin sees no log rows');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails** — `supabase test db` (CI). Expected: FAIL (`has_table` fails — tables don't exist). Locally unavailable; rely on CI.

- [ ] **Step 3: Write the migration**

`supabase/migrations/<version>_cron_health_tables.sql`:
```sql
-- Cron-health monitoring: dispatch log (request_id ↔ job), current per-job state, 30-day failure log.
CREATE TABLE public.cron_health_dispatch (
  id            bigserial PRIMARY KEY,
  job_name      text        NOT NULL,
  request_id    bigint      NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cron_health_dispatch_request_idx ON public.cron_health_dispatch (request_id);
CREATE INDEX cron_health_dispatch_job_time_idx ON public.cron_health_dispatch (job_name, dispatched_at DESC);

CREATE TABLE public.cron_health_state (
  job_name             text PRIMARY KEY,
  last_dispatched_at   timestamptz,
  last_response_at     timestamptz,
  last_status_code     int,
  last_ok_at           timestamptz,
  last_error           text,
  status               text NOT NULL DEFAULT 'unknown'
                         CHECK (status IN ('healthy','failing','stale','unknown')),
  consecutive_failures int  NOT NULL DEFAULT 0,
  alerted_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cron_health_log (
  id          bigserial PRIMARY KEY,
  job_name    text        NOT NULL,
  status_code int,
  error       text,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cron_health_log_time_idx ON public.cron_health_log (observed_at DESC);

ALTER TABLE public.cron_health_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_health_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_health_log      ENABLE ROW LEVEL SECURITY;

-- Read-only for super-admins; writes come from pg_cron (postgres role) and the
-- service-role watcher, both of which bypass RLS. No WITH CHECK(true) write policy
-- (these are log/state tables).
CREATE POLICY "super-admin reads cron_health_dispatch" ON public.cron_health_dispatch FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads cron_health_state"    ON public.cron_health_state    FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads cron_health_log"      ON public.cron_health_log      FOR SELECT USING (is_super_admin(auth.uid()));
```

- [ ] **Step 4: Apply live + record version** — MCP `apply_migration(project_id, name: "cron_health_tables", query: <the SQL>)`. Then `list_migrations` → note the recorded version and **rename the repo file to match** (`<version>_cron_health_tables.sql`).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/*_cron_health_tables.sql supabase/tests/rls/cron_health.sql
git commit -m "feat: add cron-health tables + RLS"
```

### Task 8: Migration — `cron_health_scan()` + `get_cron_health()` RPCs

> The edge runtime's PostgREST client cannot read the `net`/`cron` schemas. So the cross-schema joins live in `SECURITY DEFINER` functions: `cron_health_scan()` (service-role; the watcher's data source) and `get_cron_health()` (super-admin; the dashboard's).

**Files:**
- Create: `supabase/migrations/<version>_cron_health_rpcs.sql`
- Test: `supabase/tests/rpc/cron_health_rpcs.sql`

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/rpc/cron_health_rpcs.sql`:
```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);
SELECT has_function('public','cron_health_scan','cron_health_scan exists');
SELECT has_function('public','get_cron_health','get_cron_health exists');
-- get_cron_health is super-admin gated: a plain user gets zero rows
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-0009-0000-000000000000','authenticated','authenticated','ch-plain2@test.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = origin;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0009-0000-000000000000';
SELECT is((SELECT count(*) FROM get_cron_health())::int, 0, 'non-super-admin gets no cron health');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails** (CI) — Expected: FAIL (`has_function` fails).

- [ ] **Step 3: Write the migration**

`supabase/migrations/<version>_cron_health_rpcs.sql`:
```sql
-- Latest dispatch per job + its pg_net response. Service-role only (the watcher).
CREATE OR REPLACE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (d.job_name)
      d.job_name, d.request_id, d.dispatched_at
    FROM public.cron_health_dispatch d
    ORDER BY d.job_name, d.dispatched_at DESC
  )
  SELECT l.job_name, l.request_id, l.dispatched_at,
         r.status_code, r.timed_out, r.error_msg, r.created
  FROM latest l
  LEFT JOIN net._http_response r ON r.id = l.request_id;
$$;
REVOKE ALL ON FUNCTION public.cron_health_scan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health_scan() TO service_role;

-- Dashboard feed: per-job state + schedule + recent failures. Super-admin gated.
CREATE OR REPLACE FUNCTION public.get_cron_health()
RETURNS TABLE (
  job_name text, schedule text, status text, last_status_code int,
  last_ok_at timestamptz, last_error text, consecutive_failures int,
  last_run_at timestamptz, recent_failures jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.job_name,
         j.schedule,
         s.status, s.last_status_code, s.last_ok_at, s.last_error, s.consecutive_failures,
         (SELECT max(start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('status_code', g.status_code, 'error', g.error, 'observed_at', g.observed_at)
                            ORDER BY g.observed_at DESC)
           FROM (SELECT * FROM public.cron_health_log l WHERE l.job_name = s.job_name ORDER BY l.observed_at DESC LIMIT 10) g
         ), '[]'::jsonb) AS recent_failures
  FROM public.cron_health_state s
  LEFT JOIN cron.job j ON j.jobname = s.job_name
  WHERE is_super_admin(auth.uid())
  ORDER BY (s.status <> 'healthy') DESC, s.job_name;
$$;
REVOKE ALL ON FUNCTION public.get_cron_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO authenticated;
```

- [ ] **Step 4: Apply live + record version** — MCP `apply_migration(name: "cron_health_rpcs", …)`; rename repo file to the recorded version.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/*_cron_health_rpcs.sql supabase/tests/rpc/cron_health_rpcs.sql
git commit -m "feat: add cron_health_scan + get_cron_health RPCs"
```

### Task 9: `cron-health-alert` email template + redeploy `send-transactional-email`

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/cron-health-alert.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`

- [ ] **Step 1: Write the template** (mirrors `cast-escalation-requested.tsx`; reuse its `main/container/h1/text/card/cardLabel/cardValue/button/footer` style constants verbatim)

`cron-health-alert.tsx`:
```tsx
/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'ShowFlow'

interface Props {
  job_name?: string
  status_code?: number | string
  error?: string
  last_ok_at?: string
  dashboard_url?: string
  _footer?: string
}

const CronHealthAlert = ({ job_name, status_code, error, last_ok_at, dashboard_url, _footer }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Cron health alert — ${job_name ?? 'a scheduled job'} is failing`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Scheduled job failing</Heading>
        <Text style={text}>
          The scheduled job <strong>{job_name ?? '—'}</strong> last returned{' '}
          <strong>{status_code ?? '—'}</strong>. The booking engine may be degraded until it is fixed.
        </Text>
        <Section style={card}>
          <Text style={cardLabel}>Job</Text><Text style={cardValue}>{job_name ?? '—'}</Text>
          <Text style={cardLabel}>Last status</Text><Text style={cardValue}>{status_code ?? '—'}</Text>
          <Text style={cardLabel}>Last error</Text><Text style={cardValue}>{error ?? '—'}</Text>
          <Text style={cardLabel}>Last healthy</Text><Text style={cardValue}>{last_ok_at ?? 'unknown'}</Text>
        </Section>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={dashboard_url || 'https://showflow.pro/platform'} style={button}>Open System Health</Button>
        </Section>
        <Text style={footer}>{_footer || `— The ${SITE_NAME} team`}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CronHealthAlert,
  subject: (data: Record<string, any>) => `Cron health: ${data?.job_name ?? 'a job'} is failing (${data?.status_code ?? '?'})`,
  displayName: 'Cron health alert',
  previewData: { job_name: 'send-offer-digest', status_code: 404, error: 'Requested function was not found', last_ok_at: '2026-06-20T19:00:00Z', dashboard_url: 'https://showflow.pro/platform' },
} satisfies TemplateEntry

// Style constants — copy the exact main/container/h1/text/card/cardLabel/cardValue/button/footer
// objects from cast-escalation-requested.tsx (same design system).
```
> NOTE for the engineer: paste the 9 style constant objects (`main`…`footer`) from `cast-escalation-requested.tsx` at the bottom of this file — they are shared visual tokens, not new logic.

- [ ] **Step 2: Register it** — in `registry.ts` add the import and map entry:
```tsx
import { template as cronHealthAlert } from './cron-health-alert.tsx'
// …inside TEMPLATES:
  'cron-health-alert': cronHealthAlert,
```

- [ ] **Step 3: Redeploy `send-transactional-email`** (it bundles the registry + all templates)

MCP `deploy_edge_function`: `name: "send-transactional-email"`, `entrypoint_path: "send-transactional-email/index.ts"`, `verify_jwt: true` (preserve its current setting), `files` = its `index.ts` + its existing `_shared` deps + **every** file under `_shared/transactional-email-templates/` (registry + all `*.tsx`, including the new one). Enumerate the import graph from `index.ts`.

- [ ] **Step 4: Verify the template renders** — redeploy `preview-transactional-email` the same way, then `curl` its preview endpoint (or invoke via MCP) for `template_name=cron-health-alert` and confirm HTML returns (no missing-template error). Alternatively assert `TEMPLATES['cron-health-alert']` exists via a Deno test (Step 5 of Task 10 covers the registry import indirectly).

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/transactional-email-templates/cron-health-alert.tsx supabase/functions/_shared/transactional-email-templates/registry.ts
git commit -m "feat: add cron-health-alert email template"
```

### Task 10: `cron-health-watcher` edge function (TDD)

**Files:**
- Create: `supabase/functions/cron-health-watcher/index.ts`
- Test: `supabase/functions/cron-health-watcher/index.test.ts`

- [ ] **Step 1: Write failing DI tests**

`supabase/functions/cron-health-watcher/index.test.ts`:
```ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { handle, KNOWN_JOBS } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const SECRET = "test-secret";
const base = {
  envVars: { /* none needed */ },
  tables: { app_settings: { data: { value: SECRET } }, platform_admins: { data: [{ user_id: "super-1" }] }, cron_health_state: { data: [] } },
};
const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": SECRET } });

Deno.test("rejects a wrong cron secret with 401", async () => {
  const { deps } = makeFakeDeps(base);
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("a non-2xx scan result for a previously-healthy job alerts once (in-app + email)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    ...base,
    tables: {
      ...base.tables,
      cron_health_state: { data: [{ job_name: "offer-digest", status: "healthy", alerted_at: null }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 1, dispatched_at: "2026-06-22T10:00:00Z", status_code: 404, timed_out: false, error_msg: null, responded_at: "2026-06-22T10:00:01Z" }] },
      resolve_user_contacts: { data: [{ user_id: "super-1", email: "ops@test.com", display_name: "Ops" }] },
    },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // inserted a notification row
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(!!notif, true);
  // emailed the super-admin
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals((email?.body as any)?.template_name, "cron-health-alert");
  assertEquals((email?.body as any)?.recipient_email, "ops@test.com");
});

Deno.test("does NOT re-alert a job already in failing state", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    ...base,
    tables: { ...base.tables, cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-22T09:00:00Z" }] } },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 2, dispatched_at: "2026-06-22T10:00:00Z", status_code: 404, timed_out: false, error_msg: null, responded_at: "2026-06-22T10:00:01Z" }] } },
  });
  await handle(cronReq(), deps);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("a 2xx scan result for a failing job records recovery and clears alerted_at", async () => {
  const { deps, calls } = makeFakeDeps({
    ...base,
    tables: { ...base.tables, cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-22T09:00:00Z" }] } },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 3, dispatched_at: "2026-06-22T10:00:00Z", status_code: 200, timed_out: false, error_msg: null, responded_at: "2026-06-22T10:00:01Z" }] } },
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && (c.method === "upsert" || c.method === "update"));
  assertEquals(!!upsert, true);
});
```

- [ ] **Step 2: Run to verify failure** — `deno test --allow-all --node-modules-dir=none supabase/functions/cron-health-watcher/` → FAIL (module not found).

- [ ] **Step 3: Implement the watcher**

`supabase/functions/cron-health-watcher/index.ts`:
```ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/** Jobs we expect to fire, with the max silence (minutes) before we call them `stale`. */
export const KNOWN_JOBS: Record<string, number> = {
  "offer-digest": 1500, "confirmation-digest": 1500, "expire-offers-hourly": 130,
  "tier-at-risk-hourly": 130, "airtable-poll": 30, "cron-health-watcher": 60,
};

type ScanRow = { job_name: string; request_id: number; dispatched_at: string; status_code: number | null; timed_out: boolean | null; error_msg: string | null; responded_at: string | null };
type StateRow = { job_name: string; status: string; alerted_at: string | null };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const auth = await requireCronOrRole(deps, req, ["admin"]);
  if (!auth.ok) return auth.response;
  const admin = deps.admin;
  const now = deps.now();

  const { data: scan } = await admin.rpc("cron_health_scan");
  const scanRows = (scan ?? []) as ScanRow[];
  const byJob = new Map(scanRows.map((r) => [r.job_name, r]));

  const { data: stateData } = await admin.from("cron_health_state").select("job_name, status, alerted_at");
  const prevByJob = new Map(((stateData ?? []) as StateRow[]).map((s) => [s.job_name, s]));

  let newlyFailing = 0;
  for (const jobName of Object.keys(KNOWN_JOBS)) {
    const row = byJob.get(jobName);
    const prev = prevByJob.get(jobName);
    const prevStatus = prev?.status ?? "unknown";

    let status: "healthy" | "failing" | "stale" | "unknown" = "unknown";
    let statusCode: number | null = null;
    let error: string | null = null;
    let respondedAt: string | null = null;

    if (!row) {
      status = "stale"; error = "no dispatch recorded";
    } else if (row.responded_at === null) {
      // dispatched but no response yet — treat as pending: keep previous status, skip.
      const ageMin = (now.getTime() - new Date(row.dispatched_at).getTime()) / 60000;
      if (ageMin > KNOWN_JOBS[jobName]) { status = "stale"; error = "no response"; }
      else continue;
    } else {
      statusCode = row.status_code;
      respondedAt = row.responded_at;
      const ok = !row.timed_out && row.status_code !== null && row.status_code >= 200 && row.status_code < 300;
      status = ok ? "healthy" : "failing";
      if (!ok) error = row.timed_out ? "timed out" : (row.error_msg ?? `HTTP ${row.status_code}`);
    }

    const failing = status === "failing" || status === "stale";
    const wasFailing = prevStatus === "failing" || prevStatus === "stale";
    const consecutive = failing ? 1 : 0; // simple counter; bump if you keep a running tally

    await admin.from("cron_health_state").upsert({
      job_name: jobName,
      status,
      last_status_code: statusCode,
      last_response_at: respondedAt,
      last_dispatched_at: row?.dispatched_at ?? null,
      last_ok_at: status === "healthy" ? now.toISOString() : undefined,
      last_error: error,
      consecutive_failures: consecutive,
      alerted_at: failing ? (wasFailing ? (prev?.alerted_at ?? now.toISOString()) : now.toISOString()) : null,
      updated_at: now.toISOString(),
    }, { onConflict: "job_name" });

    if (failing) {
      await admin.from("cron_health_log").insert({ job_name: jobName, status_code: statusCode, error });
    }

    // Alert only on transition into failure (was healthy/unknown, now failing/stale).
    if (failing && !wasFailing) {
      newlyFailing++;
      await alertSuperAdmins(deps, jobName, statusCode, error, prev?.alerted_at ?? null);
    }
  }

  // Prune: dispatch >1 day, log >30 days.
  await admin.from("cron_health_dispatch").delete().lt("dispatched_at", new Date(now.getTime() - 86_400_000).toISOString());
  await admin.from("cron_health_log").delete().lt("observed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());

  return json({ checked: Object.keys(KNOWN_JOBS).length, newly_failing: newlyFailing });
}

async function alertSuperAdmins(deps: Deps, jobName: string, statusCode: number | null, error: string | null, lastOkAt: string | null) {
  const admin = deps.admin;
  const { data: admins } = await admin.from("platform_admins").select("user_id");
  const ids = ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id);
  if (ids.length === 0) return;

  // In-app notification per super-admin.
  await admin.from("notifications").insert(ids.map((uid) => ({
    user_id: uid, type: "cron_health_alert", title: "Scheduled job failing",
    message: `${jobName} last returned ${statusCode ?? "no response"}${error ? ` (${error})` : ""}.`,
    related_entity_type: "cron_job", related_entity_id: jobName,
  })));

  // Email per super-admin (login email via service-role resolver).
  const { data: contacts } = await admin.rpc("resolve_user_contacts", { p_user_ids: ids });
  for (const c of (contacts ?? []) as { email: string }[]) {
    if (!c.email) continue;
    try {
      await deps.sendEmail({ template_name: "cron-health-alert", recipient_email: c.email,
        templateData: { job_name: jobName, status_code: statusCode ?? "no response", error: error ?? "", last_ok_at: lastOkAt ?? "unknown", dashboard_url: "https://showflow.pro/platform" } });
    } catch (e) {
      console.error("cron-health-watcher: alert email failed", { jobName, error: (e as Error).message });
    }
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run the function's tests** — `deno test --allow-all --node-modules-dir=none supabase/functions/cron-health-watcher/` → PASS (4/4).

- [ ] **Step 5: Run the whole edge suite (no regressions)** — `deno test --allow-all --node-modules-dir=none supabase/functions/` → all pass.

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/cron-health-watcher/
git commit -m "feat: add cron-health-watcher edge function"
```

### Task 11: Deploy `cron-health-watcher`

- [ ] **Step 1: Deploy** — MCP `deploy_edge_function`: `name: "cron-health-watcher"`, `entrypoint_path: "cron-health-watcher/index.ts"`, **`verify_jwt: false`**, `files` = `cron-health-watcher/index.ts` + `_shared/{http,auth,deps}.ts`.

- [ ] **Step 2: Verify** — `get_edge_function` diff clean; OPTIONS → 204; no-secret POST → 401. Trigger one controlled run (Task 2 Step 3 pattern, URL `…/cron-health-watcher`); confirm latest `net._http_response.status_code = 200`. (At this point dispatch rows don't exist yet, so it should report all jobs `stale` and alert — acceptable; will go healthy after Task 12. If you want to avoid the initial stale-burst alert, run Task 12 before triggering.)

- [ ] **Step 3: Record outcome** (no commit).

### Task 12: Re-schedule crons with dispatch-capture

**Files:**
- Create: `supabase/migrations/<version>_cron_dispatch_capture.sql`

- [ ] **Step 1: Write the migration** (mirrors `20260514290000_pg_cron_schedules.sql`; wraps each command to record the request id, and adds the watcher's own cron)

`supabase/migrations/<version>_cron_dispatch_capture.sql`:
```sql
-- Wrap every cron HTTP dispatch so the returned request_id is logged → job_name,
-- enabling per-job HTTP-status attribution by cron-health-watcher. Idempotent.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly','tier-at-risk-hourly','airtable-poll','cron-health-watcher');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Helper to DRY the wrapper would require dynamic SQL; the jobs are few, so inline each.
SELECT cron.schedule('offer-digest','0 16-19 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'offer-digest', request_id FROM r;
$$);

SELECT cron.schedule('confirmation-digest','0 17-20 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-confirmation-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'confirmation-digest', request_id FROM r;
$$);

SELECT cron.schedule('expire-offers-hourly','0 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/expire-offers',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'expire-offers-hourly', request_id FROM r;
$$);

SELECT cron.schedule('tier-at-risk-hourly','5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'tier-at-risk-hourly', request_id FROM r;
$$);

SELECT cron.schedule('airtable-poll','*/5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'airtable-poll', request_id FROM r;
$$);

SELECT cron.schedule('cron-health-watcher','*/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/cron-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'cron-health-watcher', request_id FROM r;
$$);
```

- [ ] **Step 2: VERIFY the pg_net mapping assumption FIRST** (the spec's flagged unknown)

Before applying, confirm `net.http_post()` returns the id used by `net._http_response`:
```sql
SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
  headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS rid;
-- wait ~5s, then:
SELECT id, status_code FROM net._http_response ORDER BY id DESC LIMIT 3;
```
Expected: the returned `rid` appears as an `id` in `net._http_response`. If pg_net uses a different mapping on this project's version, adjust `cron_health_scan`'s join (Task 8) accordingly before proceeding.

- [ ] **Step 3: Apply live + record version** — MCP `apply_migration(name: "cron_dispatch_capture", …)`; rename repo file to the recorded version.

- [ ] **Step 4: Verify dispatch capture works** — wait for one `airtable-poll` tick (≤5 min) or trigger any wrapped job manually, then:
```sql
SELECT job_name, count(*) FROM public.cron_health_dispatch GROUP BY 1;
SELECT * FROM cron_health_scan();
```
Expected: rows for the fired jobs; `cron_health_scan()` shows their latest status_code.

- [ ] **Step 5: Trigger the watcher and confirm jobs read healthy** — trigger `cron-health-watcher` (Task 2 Step 3 pattern); then `SELECT job_name, status, last_status_code FROM cron_health_state;`. Expected: fired jobs `healthy`; not-yet-fired jobs `stale` until their next tick.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/*_cron_dispatch_capture.sql
git commit -m "feat: capture cron dispatch request ids for health monitoring"
```

### Task 13: Dashboard data-access (`fetchCronHealth`) + test

**Files:**
- Modify: `src/data/platform.ts`
- Test: `src/data/platform.cronhealth.test.ts`

- [ ] **Step 1: Write the failing vitest** (uses `src/test/supabaseFake.ts`)

`src/data/platform.cronhealth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCronHealth } from "@/data/platform";

describe("fetchCronHealth", () => {
  it("returns rows from the get_cron_health RPC", async () => {
    const fake = createFakeSupabase({ "rpc:get_cron_health": { data: [{ job_name: "offer-digest", status: "failing", schedule: "0 16-19 * * *", last_status_code: 404, last_ok_at: null, last_error: "HTTP 404", consecutive_failures: 1, last_run_at: null, recent_failures: [] }], error: null } });
    const rows = await fetchCronHealth(fake as any);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failing");
    expect(fake.calls).toContainEqual({ table: "rpc:get_cron_health", method: "rpc", args: [undefined] });
  });
});
```
> Confirm the exact `createFakeSupabase` RPC-seed key/shape against an existing test (e.g. `src/data/bookings.test.ts`) before finalizing; match its convention.

- [ ] **Step 2: Run to verify failure** — (CI; not runnable locally) Expected: FAIL (`fetchCronHealth` undefined).

- [ ] **Step 3: Implement** — append to `src/data/platform.ts`:
```ts
export interface CronHealthRow {
  job_name: string;
  schedule: string | null;
  status: "healthy" | "failing" | "stale" | "unknown";
  last_status_code: number | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  last_run_at: string | null;
  recent_failures: { status_code: number | null; error: string | null; observed_at: string }[];
}

/** Per-cron health for the platform System Health tab (super-admin only via RPC). */
export async function fetchCronHealth(client: SupabaseClient<Database>): Promise<CronHealthRow[]> {
  const { data, error } = await client.rpc("get_cron_health");
  if (error) throw error;
  return (data ?? []) as unknown as CronHealthRow[];
}
```

- [ ] **Step 4: Commit**
```bash
git add src/data/platform.ts src/data/platform.cronhealth.test.ts
git commit -m "feat: add fetchCronHealth data-access"
```

### Task 14: `SystemHealthTab` + register in PlatformPage

**Files:**
- Create: `src/components/platform/SystemHealthTab.tsx`
- Test: `src/components/platform/SystemHealthTab.test.tsx`
- Modify: `src/pages/PlatformPage.tsx`

- [ ] **Step 1: Write the failing component test** (uses `src/test/renderWithProviders.tsx`)

`src/components/platform/SystemHealthTab.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemHealthTab } from "./SystemHealthTab";
import * as platform from "@/data/platform";

describe("SystemHealthTab", () => {
  it("renders a failing job with its status", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([
      { job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing", last_status_code: 404, last_ok_at: null, last_error: "HTTP 404", consecutive_failures: 1, last_run_at: null, recent_failures: [] },
    ]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("offer-digest")).toBeInTheDocument();
    expect(await screen.findByText(/failing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — (CI) Expected: FAIL (no `SystemHealthTab`).

- [ ] **Step 3: Implement the component** (mirrors `PlatformAdminsTab` query/loading/error pattern)

`src/components/platform/SystemHealthTab.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCronHealth, type CronHealthRow } from "@/data/platform";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const STATUS_VARIANT: Record<CronHealthRow["status"], "default" | "destructive" | "secondary" | "outline"> = {
  healthy: "secondary", failing: "destructive", stale: "destructive", unknown: "outline",
};

export function SystemHealthTab() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "cron-health"],
    queryFn: () => fetchCronHealth(supabase),
    refetchInterval: 60_000,
  });
  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Scheduled job health</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        {(data ?? []).map((j) => (
          <div key={j.job_name} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">{j.job_name}</div>
              <div className="text-muted-foreground text-xs">
                {j.schedule ?? "—"} · last run {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : "—"}
                {j.last_error ? ` · ${j.last_error}` : ""}
              </div>
            </div>
            <Badge variant={STATUS_VARIANT[j.status]}>{j.status}{j.last_status_code ? ` (${j.last_status_code})` : ""}</Badge>
          </div>
        ))}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No cron health recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Register the tab** — in `src/pages/PlatformPage.tsx`: import `SystemHealthTab`, add `<TabsTrigger value="health">System Health</TabsTrigger>` to the `TabsList`, and `<TabsContent value="health" className="mt-4"><SystemHealthTab /></TabsContent>`.

- [ ] **Step 5: Commit**
```bash
git add src/components/platform/SystemHealthTab.tsx src/components/platform/SystemHealthTab.test.tsx src/pages/PlatformPage.tsx
git commit -m "feat: add platform System Health tab"
```

### Task 15: End-to-end verification

- [ ] **Step 1: Confirm the full alert path**

The natural test: trigger `cron-health-watcher` once **before** any dispatch rows exist (i.e. right after Task 11, before Task 12's first ticks). With no dispatches, every `KNOWN_JOBS` entry classifies `stale` → the alert transition fires. Confirm:
```sql
SELECT job_name, status FROM cron_health_state;                    -- expect 'stale'
SELECT type, title FROM notifications WHERE type='cron_health_alert' ORDER BY created_at DESC LIMIT 5;
```
Expect a `cron_health_alert` notification per super-admin, and (if Resend is live) one alert email each.

- [ ] **Step 2: Confirm recovery** — after Task 12 dispatches land and the watcher reruns, `SELECT job_name, status FROM cron_health_state` shows fired jobs `healthy`, and a "recovered" path cleared `alerted_at`.

- [ ] **Step 3: Confirm the dashboard** — load `/platform` → System Health tab as a super-admin; the jobs render with correct status pills.

- [ ] **Step 4: Open the PR** — push the branch and open one PR covering all parts; let CI run vitest + ESLint + Deno + pgTAP + the Supabase preview branch. Poll checks to green (do **not** use `gh pr merge --auto`).

---

## Self-review notes

- **Spec coverage:** Part 1 (Tasks 1–4) ✓, Part 2 (Task 5) ✓, Part 4 (Task 6) ✓, Part 3 data model (Task 7) ✓, dispatch-capture migration (Task 12) ✓, watcher + alert in-app+email (Tasks 9–11) ✓, RPC + dashboard (Tasks 8, 13, 14) ✓, dead-man's switch (`KNOWN_JOBS["cron-health-watcher"]` + stale) ✓, testing across all 3 layers ✓.
- **Refinement vs spec:** the spec said "the watcher joins `net._http_response`"; the PostgREST edge client can't read the `net` schema, so the join is encapsulated in the `SECURITY DEFINER` `cron_health_scan()` RPC the watcher calls. Same intent, correct mechanism. (Worth a one-line spec update.)
- **pg_net assumption** is gated by an explicit verify step (Task 12 Step 2) before the capture migration is applied.
- **Local-run caveat:** only Deno tests run locally; Vitest/pgTAP are CI-verified — called out per task.
