# Multi-Tenancy Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the database multi-tenant-ready — add the platform layer (organizations, memberships, invitations, super-admin), put `org_id` on every tenant table, replace `has_role` with three org-aware security-definer helpers, rewrite every RLS policy to be org-scoped via one config-driven generator, seed a bootstrap org so the existing app keeps working — all proven by a pgTAP isolation suite + coverage test before merge.

**Architecture:** Pooled multi-tenancy (one DB, one schema, `org_id` + RLS). Isolation rides on `is_org_member(org_id)` in RLS, never on client filtering. A single config-driven `DO` block drops all existing tenant-table policies and regenerates org-scoped ones, preserving each table's real read/write intent. A bootstrap org + a temporary column `DEFAULT` keeps the (still org-unaware) frontend working until Phase 1 wires the org context.

**Tech Stack:** Supabase Postgres, RLS, pgTAP (`supabase test db`, CLI pinned 2.98.2), Supabase CLI migrations, generated `src/integrations/supabase/types.ts`, Vitest for the app build/test gate.

**Spec:** `docs/superpowers/specs/2026-06-03-multi-tenancy-design.md` (§4 data model, §5 security, §10 migration, §11 phasing).

---

## Execution adjustments (CI-driven run, 2026-06-03)

This phase is being executed by **authoring files and validating on GitHub Actions CI** (no local Supabase/Docker/Node on the authoring box). Three deviations from the task bodies below:

1. **`user_roles` + `has_role` are KEPT (vestigial) this phase**, *not* dropped in Task 0.3. The live `AuthContext` still queries `user_roles` at runtime; dropping it would break the running app (CI's Vitest uses the fake client and wouldn't catch that). They are dropped in **Phase 1**, when `AuthContext` is rewired to `org_memberships`. `is_chat_participant` is updated to be org-aware in iteration 2 so chat policies don't depend on the vestigial `has_role`.
2. **`types.ts` regen (Task 0.6) is deferred to Phase 1** — no frontend references the new tables yet, so lint/Vitest stay green on the committed file.
3. **Staged into two CI runs** on a draft PR → `dev`: (i) platform tables + helpers + `org_id`/bootstrap + helper & coverage tests, existing tests untouched (expected green); (ii) policy rewrite + isolation suite + migrating the existing pgTAP tests. The coverage test emits assertions as top-level set-returning `SELECT is(...)` — **not** a `DO` loop, because `PERFORM`'d pgTAP assertions never reach the TAP stream.
4. **The uniqueness swaps are DEFERRED** out of Task 0.2. Migration 2 is now *purely additive* (only adds `org_id`). Dropping `app_settings`'s `UNIQUE(key)` broke existing `INSERT ... ON CONFLICT (key)` upserts (the trigger pgTAP suite caught it on the first CI run). The swaps (`artists` → `UNIQUE(org_id,user_id)`; `app_settings` → per-`(org,key)` + platform-`NULL`) move to the phase that also updates every `ON CONFLICT`/upsert call site. With only the bootstrap org in play this phase, the global uniques remain correct.

## Conventions for every task in this plan

- **Work on branch `feature/multi-tenancy`** (already created).
- **Migrations are created with the CLI, never hand-numbered:** `supabase migration new <slug>` generates the timestamped file under `supabase/migrations/`; you then write SQL into the file it prints. Never edit an existing migration.
- **The red/green loop for DB work:**
  - Apply migrations to the local stack: `supabase db reset` (re-applies all migrations from scratch — catches ordering bugs).
  - Run DB tests: `supabase test db` (runs every file under `supabase/tests/`).
  - A "failing test" for schema-dependent pgTAP means `supabase test db` reports failures/errors (e.g. *relation/function does not exist*). That is the expected RED.
- **If the local Supabase CLI/Docker stack is unavailable in your environment,** apply the same SQL via the Supabase MCP (`apply_migration` for each migration file's contents) and run each `supabase/tests/**.sql` file's body via `execute_sql`. The SQL is identical; only the runner differs. Prefer the CLI when available because it matches CI exactly.
- **Bootstrap org UUID is a fixed constant used in several files:** `00000000-0000-0000-0000-00000000b007`. Search the repo for it if you need to find every reference.
- **Commit after each task** with the message shown in that task's final step.

---

## File structure

**Migrations created (via `supabase migration new`):**
- `..._add_platform_tables_and_org_helpers.sql` — `organizations`, `platform_admins`, `org_memberships`, `org_invitations`; the 3 helper functions; RLS on the 4 platform tables.
- `..._add_org_id_to_tenant_tables.sql` — bootstrap org row; `org_id` on every tenant table; membership backfill from `user_roles`; uniqueness swaps (`artists`, `app_settings`).
- `..._org_scoped_rls_policies.sql` — drop all tenant-table policies; regenerate org-scoped policies from the config; drop `has_role` + `user_roles`.

**pgTAP tests created:**
- `supabase/tests/rls/org_helpers_and_platform.sql` — helper-function + platform-table RLS behavior.
- `supabase/tests/rls/org_coverage.sql` — **coverage guard**: every tenant table has `org_id` + RLS on + the standard policies.
- `supabase/tests/rls/org_isolation.sql` — **isolation suite ★**: org A's session reads/writes zero of org B's rows across the core tables; super-admin sees all.

**pgTAP tests modified (fixtures move `user_roles` → `org_memberships`):**
- `supabase/tests/rls/bookings_and_audit.sql`
- `supabase/tests/rls/reference_tables.sql`
- `supabase/tests/rls/chats.sql`
- `supabase/tests/rls/availability_blocked_dates.sql`
- `supabase/tests/rls/notifications_roles_approvals.sql`
- `supabase/tests/rls/offer_engine_tables.sql`
- (and any of `supabase/tests/rpc/*` / `supabase/tests/triggers/*` whose fixtures insert into `user_roles` — Task 0.5 finds them)

**Generated (not hand-edited):**
- `src/integrations/supabase/types.ts` — regenerated in Task 0.6.

---

## Task 0.0: Baseline — confirm the existing suite is green before touching anything

**Files:** none (verification only)

- [ ] **Step 1: Apply all migrations to a fresh local DB**

Run: `supabase db reset`
Expected: completes without error; prints "Applying migration …" for each file and finishes with the seed step.

- [ ] **Step 2: Run the existing pgTAP suite to capture the green baseline**

Run: `supabase test db`
Expected: PASS for every file under `supabase/tests/` (rls, rpc, triggers). If anything is already failing, STOP and report — do not start Phase 0 on a red baseline.

- [ ] **Step 3: Confirm the app builds and unit tests pass**

Run: `npm ci && npm run lint && npm test && npm run build`
Expected: all four succeed. This is the "app still works" bar Phase 0 must preserve.

No commit (verification only).

---

## Task 0.1: Platform tables + the three org-aware helper functions

**Files:**
- Create migration: `supabase/migrations/..._add_platform_tables_and_org_helpers.sql`
- Create test: `supabase/tests/rls/org_helpers_and_platform.sql`

- [ ] **Step 1: Write the failing pgTAP test for the helpers + platform-table RLS**

Create `supabase/tests/rls/org_helpers_and_platform.sql`:

```sql
-- Helper functions (is_super_admin / is_org_member / has_org_role) and RLS on the
-- platform tables (organizations, platform_admins, org_memberships, org_invitations).
--
-- UUID legend (test-only, rolled back):
--   aaaa…0001 super-admin user      aaaa…0002 org-A admin
--   aaaa…0003 org-A artist          aaaa…0004 outsider (no membership)
--   0000…A000 org A                 0000…B000 org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','ph-super@test.com',  now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000','authenticated','authenticated','ph-aadmin@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000','authenticated','authenticated','ph-aartist@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000','authenticated','authenticated','ph-out@test.com',    now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Org A','org-a'),
  ('00000000-0000-0000-0000-00000000b000','Org B','org-b');

INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-0002-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-0003-0000-000000000000','artist');

SET session_replication_role = DEFAULT;

-- ── helper functions (executed as definer-owner; call directly) ──
SELECT ok( public.is_super_admin('aaaaaaaa-aaaa-0001-0000-000000000000'),       'super-admin recognized');
SELECT ok( NOT public.is_super_admin('aaaaaaaa-aaaa-0002-0000-000000000000'),   'org-admin is not super-admin');
SELECT ok( public.is_org_member('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000a000'), 'artist is member of org A');
SELECT ok( NOT public.is_org_member('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000b000'), 'artist is NOT member of org B');
SELECT ok( public.is_org_member('aaaaaaaa-aaaa-0001-0000-000000000000','00000000-0000-0000-0000-00000000b000'), 'super-admin passes is_org_member for any org');
SELECT ok( public.has_org_role('aaaaaaaa-aaaa-0002-0000-000000000000','00000000-0000-0000-0000-00000000a000','admin'), 'org-A admin has admin role in A');
SELECT ok( NOT public.has_org_role('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000a000','admin'), 'org-A artist lacks admin role');

-- ── organizations RLS: members see their org, outsiders do not ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.organizations WHERE id='00000000-0000-0000-0000-00000000a000'),1,'member sees own org');
SELECT is((SELECT count(*)::int FROM public.organizations WHERE id='00000000-0000-0000-0000-00000000b000'),0,'member cannot see other org');
RESET ROLE;

-- ── org_memberships RLS: an org-admin can invite within their org; an artist cannot ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.org_invitations (org_id, email, role, invited_by)
    VALUES ('00000000-0000-0000-0000-00000000a000','newprod@test.com','producer','aaaaaaaa-aaaa-0002-0000-000000000000')$$,
  'org-admin can create an invitation for their org');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.org_invitations (org_id, email, role, invited_by)
    VALUES ('00000000-0000-0000-0000-00000000a000','x@test.com','producer','aaaaaaaa-aaaa-0003-0000-000000000000')$$,
  '42501', null, 'artist cannot create an invitation');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db`
Expected: FAIL — errors like `relation "public.organizations" does not exist` / `function public.is_super_admin(uuid) does not exist`.

- [ ] **Step 3: Create the migration**

Run: `supabase migration new add_platform_tables_and_org_helpers`
Then write this into the file it created:

```sql
-- Platform layer for multi-tenancy + org-aware security-definer helpers.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger update_organizations_updated_at before update on public.organizations
  for each row execute function public.update_updated_at_column();

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);
create index idx_org_memberships_user on public.org_memberships(user_id);
create index idx_org_memberships_org  on public.org_memberships(org_id);

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role app_role not null,
  token text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_org_invitations_org   on public.org_invitations(org_id);
create index idx_org_invitations_email on public.org_invitations(lower(email));

-- ── Helper functions (replace global has_role). SECURITY DEFINER so they bypass
--    RLS on their lookup tables, avoiding recursion (same pattern as has_role). ──
create or replace function public.is_super_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = _uid)
$$;

create or replace function public.is_org_member(_uid uuid, _org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships where user_id = _uid and org_id = _org)
$$;

create or replace function public.has_org_role(_uid uuid, _org uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships
                 where user_id = _uid and org_id = _org and role = _role)
$$;

-- ── RLS on the platform tables ──
alter table public.organizations  enable row level security;
alter table public.platform_admins enable row level security;
alter table public.org_memberships enable row level security;
alter table public.org_invitations enable row level security;

create policy organizations_read on public.organizations for select to authenticated
  using ( public.is_org_member(auth.uid(), id) );
create policy organizations_write on public.organizations for all to authenticated
  using ( public.is_super_admin(auth.uid()) ) with check ( public.is_super_admin(auth.uid()) );

create policy platform_admins_super on public.platform_admins for all to authenticated
  using ( public.is_super_admin(auth.uid()) ) with check ( public.is_super_admin(auth.uid()) );

create policy org_memberships_read on public.org_memberships for select to authenticated
  using ( public.is_org_member(auth.uid(), org_id) );
create policy org_memberships_write on public.org_memberships for all to authenticated
  using ( public.has_org_role(auth.uid(), org_id, 'admin') )
  with check ( public.has_org_role(auth.uid(), org_id, 'admin') );

create policy org_invitations_rw on public.org_invitations for all to authenticated
  using ( public.has_org_role(auth.uid(), org_id, 'admin') )
  with check ( public.has_org_role(auth.uid(), org_id, 'admin') );
```

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: `org_helpers_and_platform.sql` PASSES all 12; the existing suite is still green (it does not touch these new tables yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rls/org_helpers_and_platform.sql
git commit -m "add platform tables and org-aware rls helpers" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 0.2: Add `org_id` to every tenant table + bootstrap org + membership backfill

**Files:**
- Create migration: `supabase/migrations/..._add_org_id_to_tenant_tables.sql`
- Create test: `supabase/tests/rls/org_coverage.sql` (schema half now; policy half asserted after Task 0.3)

- [ ] **Step 1: Write the failing coverage test (schema assertions)**

Create `supabase/tests/rls/org_coverage.sql`:

```sql
-- Coverage guard: every tenant table must carry org_id and have RLS enabled.
-- The policy-presence assertions are satisfied by Task 0.3.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- The canonical list of tenant tables (everything org-scoped). profiles is GLOBAL
-- and intentionally excluded; user_roles/user_approvals are dropped by Phase 0.
CREATE TEMP TABLE _tenant_tables(name text) ON COMMIT DROP;
INSERT INTO _tenant_tables(name) VALUES
  ('shows'),('show_dates'),('show_date_offer_tiers'),('show_cast_eligibility'),
  ('show_date_cast_eligibility'),('bookings'),('booking_audit_log'),('casts'),
  ('cast_members'),('cast_city_priority'),('cities'),('skills'),('artist_skills'),
  ('blocked_dates'),('show_assignments'),('chats'),('chat_messages'),
  ('notifications'),('airtable_sync_log'),('artists'),('app_settings');

SELECT plan( (SELECT count(*)::int * 2 FROM _tenant_tables) );

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT name FROM _tenant_tables LOOP
    -- 1) org_id column exists
    PERFORM is(
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name=r.name AND column_name='org_id'),
      1, r.name || ' has org_id column');
    -- 2) RLS is enabled
    PERFORM is(
      (SELECT relrowsecurity::int FROM pg_class
        WHERE oid = ('public.'||r.name)::regclass),
      1, r.name || ' has RLS enabled');
  END LOOP;
END $$;

SELECT * FROM finish();
ROLLBACK;
```

> Note: `is()` inside a `DO` loop is called via `PERFORM`; pgTAP records each call. The `plan(N)` count is `2 × table count` = 42.

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db`
Expected: FAIL — every `… has org_id column` assertion fails (column absent).

- [ ] **Step 3: Create the migration**

Run: `supabase migration new add_org_id_to_tenant_tables`
Write into the new file:

```sql
-- Bootstrap org keeps the (still org-unaware) frontend working: a temporary
-- column DEFAULT routes any insert that omits org_id into this org, and existing
-- users are enrolled here. Phase 1 removes the DEFAULTs once the client sets org_id.
insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-00000000b007','Bootstrap Org','bootstrap');

-- Enroll all existing role-holders into the bootstrap org with the same role.
insert into public.org_memberships (org_id, user_id, role)
select '00000000-0000-0000-0000-00000000b007', user_id, role
from public.user_roles
on conflict (org_id, user_id, role) do nothing;

-- Add org_id NOT NULL DEFAULT bootstrap + FK + index to each tenant table.
-- app_settings is handled separately below (nullable org_id = platform default).
do $$
declare
  t text;
  bootstrap constant uuid := '00000000-0000-0000-0000-00000000b007';
  tbls text[] := array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists'
  ];
begin
  foreach t in array tbls loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid not null default %L references public.organizations(id)',
      t, bootstrap);
    execute format(
      'create index if not exists %I on public.%I(org_id)',
      'idx_'||t||'_org', t);
  end loop;
end $$;

-- artists: replace global UNIQUE(user_id) with per-org uniqueness.
alter table public.artists drop constraint if exists artists_user_id_key;
drop index if exists public.artists_user_id_key;
create unique index artists_org_user_uniq
  on public.artists(org_id, user_id) where user_id is not null;

-- app_settings: nullable org_id (NULL = platform default); per-(org,key) uniqueness.
alter table public.app_settings add column if not exists org_id uuid references public.organizations(id);
create index if not exists idx_app_settings_org on public.app_settings(org_id);
alter table public.app_settings drop constraint if exists app_settings_key_key;
drop index if exists public.app_settings_key_key;
create unique index app_settings_platform_key on public.app_settings(key) where org_id is null;
create unique index app_settings_org_key       on public.app_settings(org_id, key) where org_id is not null;
-- Existing global settings rows keep org_id = NULL → they become the platform defaults.
```

> If `supabase db reset` errors on `drop constraint artists_user_id_key`, the auto-generated name differs. Find it with:
> `select conname from pg_constraint where conrelid='public.artists'::regclass and contype='u';`
> and substitute it. Same approach for `app_settings_key_key`.

- [ ] **Step 4: Apply and verify the coverage test's schema half passes**

Run: `supabase db reset && supabase test db -- --files supabase/tests/rls/org_coverage.sql` (or run the whole suite).
Expected: `org_coverage.sql` PASSES all 42. The 6 existing RLS tests now FAIL (they insert into `user_roles`, and policies still use `has_role` — that's expected and fixed in Tasks 0.3–0.5). Note which fail; you'll green them shortly.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rls/org_coverage.sql
git commit -m "add org_id to tenant tables, bootstrap org, membership backfill" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 0.3: Config-driven org-scoped RLS rewrite (+ isolation suite ★)

**Files:**
- Create migration: `supabase/migrations/..._org_scoped_rls_policies.sql`
- Create test: `supabase/tests/rls/org_isolation.sql`
- Modify test: `supabase/tests/rls/org_coverage.sql` (add policy-presence assertions)

- [ ] **Step 1: Write the failing isolation suite**

Create `supabase/tests/rls/org_isolation.sql`:

```sql
-- ISOLATION SUITE ★ — proves org A's session reads/writes zero of org B's rows
-- across the core tables, and that super-admin sees everything.
--
--   aaaa…0001 super-admin   aaaa…00A2 org-A producer   aaaa…00B2 org-B producer
--   0000…A000 org A         0000…B000 org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','iso-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00a2-0000-000000000000','authenticated','authenticated','iso-aprod@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00b2-0000-000000000000','authenticated','authenticated','iso-bprod@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Iso A','iso-a'),
  ('00000000-0000-0000-0000-00000000b000','Iso B','iso-b');

INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-00a2-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b000','aaaaaaaa-aaaa-00b2-0000-000000000000','producer');

-- One show per org (org_id set explicitly; the column default is irrelevant here).
INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('cccccccc-cccc-000a-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000a000'),
  ('cccccccc-cccc-000b-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-dddd-000a-0000-000000000000','cccccccc-cccc-000a-0000-000000000000','2099-01-01','20:00','00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-dddd-000b-0000-000000000000','cccccccc-cccc-000b-0000-000000000000','2099-01-01','20:00','00000000-0000-0000-0000-00000000b000');

SET session_replication_role = DEFAULT;

-- ── Org-A producer: sees A's show/show_date, NOT B's ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00a2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows      WHERE id='cccccccc-cccc-000a-0000-000000000000'),1,'A-prod sees own show');
SELECT is((SELECT count(*)::int FROM public.shows      WHERE id='cccccccc-cccc-000b-0000-000000000000'),0,'A-prod cannot see B show');
SELECT is((SELECT count(*)::int FROM public.show_dates WHERE org_id='00000000-0000-0000-0000-00000000b000'),0,'A-prod sees zero B show_dates');
-- write-side: A-prod cannot create a show inside org B (WITH CHECK blocks it)
SELECT throws_ok(
  $$INSERT INTO public.shows (program, sub_program, org_id)
    VALUES ('x','y','00000000-0000-0000-0000-00000000b000')$$,
  '42501', null, 'A-prod cannot insert a show into org B');
-- write-side: A-prod cannot smuggle an A row over to B via UPDATE
SELECT lives_ok(
  $$UPDATE public.shows SET org_id='00000000-0000-0000-0000-00000000b000'
    WHERE id='cccccccc-cccc-000a-0000-000000000000'$$,
  'update statement runs');
SELECT is((SELECT org_id FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),
          '00000000-0000-0000-0000-00000000a000'::uuid,
          'A show NOT moved to B — WITH CHECK blocked the cross-org update');
RESET ROLE;

-- ── Org-B producer: cannot see A ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00b2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),0,'B-prod cannot see A show');
RESET ROLE;

-- ── Super-admin: god-mode sees both ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id IN
            ('cccccccc-cccc-000a-0000-000000000000','cccccccc-cccc-000b-0000-000000000000')),2,'super-admin sees both orgs'' shows');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Add policy-presence assertions to the coverage test**

In `supabase/tests/rls/org_coverage.sql`, change `SELECT plan(...)` to allocate one more assertion per table and add a policy-count check inside the loop. Replace the `plan` line and loop body with:

```sql
SELECT plan( (SELECT count(*)::int * 3 FROM _tenant_tables) );

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT name FROM _tenant_tables LOOP
    PERFORM is(
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name=r.name AND column_name='org_id'),
      1, r.name || ' has org_id column');
    PERFORM is(
      (SELECT relrowsecurity::int FROM pg_class WHERE oid=('public.'||r.name)::regclass),
      1, r.name || ' has RLS enabled');
    -- at least one SELECT policy that references is_org_member OR auth.uid()=user_id
    PERFORM ok(
      EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename=r.name AND cmd IN ('SELECT','ALL')),
      r.name || ' has a read policy');
  END LOOP;
END $$;
```

- [ ] **Step 3: Run both tests and watch them fail**

Run: `supabase test db`
Expected: `org_isolation.sql` FAILS (old `has_role` policies don't scope by org, so A-prod sees B's show / the cross-org insert is allowed). `org_coverage.sql` may pass read-policy presence (old policies exist) but isolation is the real RED here.

- [ ] **Step 4: Create the policy-rewrite migration**

Run: `supabase migration new org_scoped_rls_policies`
Write into the new file:

```sql
-- Replace every tenant-table policy with org-scoped policies generated from one
-- config. Drop has_role + user_roles last (now unused).

-- 1) Drop ALL existing policies on the tenant tables (catalog-driven; we do not
--    rely on knowing their evolved names).
do $$
declare r record;
  tbls text[] := array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists','app_settings'
  ];
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname='public' and tablename = any(tbls)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) Regenerate policies from config.
--    read_scope:  member | staff | self_user   (staff = member AND admin|producer)
--    write_role:  producer | admin | none       (producer = producer OR admin)
--    extras:      see the per-tag self/insert clauses appended after the loop.
do $$
declare
  c record;
  read_expr text;
  write_expr text;
begin
  for c in
    select * from (values
      ('shows','member','producer'),
      ('show_dates','member','producer'),
      ('show_date_offer_tiers','member','producer'),
      ('show_cast_eligibility','member','producer'),
      ('show_date_cast_eligibility','member','producer'),
      ('bookings','member','producer'),
      ('casts','member','producer'),
      ('cast_members','member','producer'),
      ('cast_city_priority','member','producer'),
      ('cities','member','producer'),
      ('skills','member','producer'),
      ('artist_skills','member','producer'),
      ('blocked_dates','member','producer'),
      ('show_assignments','member','admin'),
      ('chats','member','producer'),
      ('chat_messages','member','producer'),
      ('artists','member','producer'),
      ('booking_audit_log','staff','none'),
      ('airtable_sync_log','staff','none'),
      ('notifications','self_user','none'),
      ('app_settings','member','admin')
    ) as t(tbl, read_scope, write_role)
  loop
    -- read expression
    read_expr := case c.read_scope
      when 'member'   then 'public.is_org_member(auth.uid(), org_id)'
      when 'staff'    then 'public.is_org_member(auth.uid(), org_id) and '
                         || '(public.has_org_role(auth.uid(),org_id,''admin'') '
                         || ' or public.has_org_role(auth.uid(),org_id,''producer''))'
      when 'self_user' then 'auth.uid() = user_id'
    end;
    -- app_settings can also read platform defaults (org_id is null)
    if c.tbl = 'app_settings' then
      read_expr := '(org_id is null or '||read_expr||')';
    end if;

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      c.tbl||'_read', c.tbl, read_expr);

    if c.write_role <> 'none' then
      write_expr := case c.write_role
        when 'producer' then '(public.has_org_role(auth.uid(),org_id,''producer'') '
                            ||' or public.has_org_role(auth.uid(),org_id,''admin''))'
        when 'admin'    then 'public.has_org_role(auth.uid(),org_id,''admin'')'
      end;
      execute format(
        'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
        c.tbl||'_write', c.tbl, write_expr, write_expr);
    end if;
  end loop;
end $$;

-- 3) Preserve the artist-self behaviors that exist today (now ANDed with org scope).

-- artists: an artist can update their own org-scoped profile row.
create policy artists_self_update on public.artists for update to authenticated
  using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );

-- bookings: an artist can respond to their own offer (suggested → soft_booked|cancelled).
create policy bookings_artist_respond on public.bookings for update to authenticated
  using ( exists (select 1 from public.artists a
                  where a.id = bookings.artist_id and a.user_id = auth.uid())
          and status = 'suggested' )
  with check ( exists (select 1 from public.artists a
                       where a.id = bookings.artist_id and a.user_id = auth.uid())
               and status in ('soft_booked','cancelled') );

-- blocked_dates: an artist manages their own blocked dates.
create policy blocked_dates_self on public.blocked_dates for all to authenticated
  using ( exists (select 1 from public.artists a
                  where a.id = blocked_dates.artist_id and a.user_id = auth.uid()) )
  with check ( exists (select 1 from public.artists a
                       where a.id = blocked_dates.artist_id and a.user_id = auth.uid()) );

-- notifications: a user updates their own (read flag). Inserts come from SECURITY
-- DEFINER triggers / service role, so no permissive INSERT policy is needed.
create policy notifications_self_update on public.notifications for update to authenticated
  using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );

-- chat_messages: a chat participant may post (is_chat_participant already encodes
-- admin/producer/booked-artist; it now also implies the same org).
create policy chat_messages_participant_insert on public.chat_messages for insert to authenticated
  with check ( public.is_chat_participant(chat_id, auth.uid()) );

-- 4) Retire the global role system (now unused by any policy).
drop function if exists public.has_role(uuid, app_role);
drop table if exists public.user_roles;
```

> The `booking_audit_log` / `airtable_sync_log` / `notifications` old `WITH CHECK (true)` INSERT policies are intentionally NOT recreated — their writers are SECURITY DEFINER triggers/service-role and bypass RLS, so dropping the permissive insert policy removes the smell flagged in CLAUDE.md without breaking writes. Task 0.5 confirms the trigger tests still pass.

- [ ] **Step 5: Apply and verify isolation + coverage pass**

Run: `supabase db reset && supabase test db`
Expected: `org_isolation.sql` and `org_coverage.sql` PASS. (The 6 pre-existing RLS tests + any rpc/trigger tests using `user_roles` still FAIL — Task 0.5 fixes them.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/rls/org_isolation.sql supabase/tests/rls/org_coverage.sql
git commit -m "rewrite rls as org-scoped policies; drop has_role/user_roles" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 0.4: Update one existing RLS test to the org model (worked example)

**Files:**
- Modify test: `supabase/tests/rls/bookings_and_audit.sql`

The mechanical transform for **every** existing test that fails:
1. Replace the `INSERT INTO public.user_roles (...) VALUES (...)` block with an equivalent `INSERT INTO public.org_memberships (org_id, user_id, role) VALUES (...)` block using the bootstrap org `00000000-0000-0000-0000-00000000b007` (the column DEFAULT already stamps the domain rows with the same org, so the users and their data share one org).
2. If the test asserted a role-based read that the new uniform rule changes, keep the *intended* assertion (e.g. audit log stays staff-only — that intent is preserved by the `staff` read_scope, so the existing "artist sees zero audit rows" assertion still holds).

- [ ] **Step 1: Apply the transform to `bookings_and_audit.sql`**

Replace lines 51–55 (the `user_roles` insert):

```sql
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'admin'::app_role),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'producer'::app_role),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'artist'::app_role),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'artist'::app_role);
```

with:

```sql
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist');
```

No other change is needed: the `shows`/`show_dates`/`artists`/`bookings` inserts omit `org_id`, so the bootstrap DEFAULT stamps them all into the bootstrap org, and all four users are members of it. The artist-A/artist-B visibility assertions still hold because `bookings_read` is `member` scope **and** the `bookings_artist_respond` + "Artists can view own bookings" intent is preserved (artist B is a member, so they *can* now see artist A's booking row by org membership — **this assertion changes**; see Step 2).

- [ ] **Step 2: Reconcile the one assertion the uniform read changes**

Under org scoping, `bookings_read = is_org_member`, so a member artist sees *all* bookings in their org. Test 4 ("artist B cannot see artist A booking", expects 0) is now wrong. Change its expected value and message:

```sql
-- 4. Artist B (same org) CAN see artist A's booking under org-member read scope.
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'artist B (same org) sees artist A booking via org-member read'
);
```

> This is an intra-org visibility relaxation that the spec's uniform read model intends. Cross-*org* isolation is proven separately in `org_isolation.sql`. If you instead want bookings to stay artist-private within an org, that is a deliberate scope change — raise it rather than silently tightening the policy here.

- [ ] **Step 3: Run and verify this file passes**

Run: `supabase test db`
Expected: `bookings_and_audit.sql` PASSES. Other un-migrated files may still fail.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/rls/bookings_and_audit.sql
git commit -m "migrate bookings rls test to org_memberships model" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 0.5: Migrate the remaining existing DB tests to the org model

**Files (modify):**
- `supabase/tests/rls/reference_tables.sql`
- `supabase/tests/rls/chats.sql`
- `supabase/tests/rls/availability_blocked_dates.sql`
- `supabase/tests/rls/notifications_roles_approvals.sql`
- `supabase/tests/rls/offer_engine_tables.sql`
- Any `supabase/tests/rpc/*.sql` or `supabase/tests/triggers/*.sql` that insert into `user_roles`

- [ ] **Step 1: Find every remaining file that references `user_roles`**

Run: `grep -rln "user_roles" supabase/tests/`
Expected: a list of the files still on the old model. Work through each.

- [ ] **Step 2: Apply the same transform to each file**

In every listed file, replace the `INSERT INTO public.user_roles (user_id, role) VALUES (…)` block with the `INSERT INTO public.org_memberships (org_id, user_id, role) VALUES (…)` form using bootstrap org `00000000-0000-0000-0000-00000000b007` (prefix each tuple with the bootstrap org_id, same as Task 0.4 Step 1).

- [ ] **Step 3: For each file, reconcile assertions the uniform read changes**

Re-run after each edit and fix only assertions that change *because of intended org-scoping*, not because of a real regression:
- `notifications_roles_approvals.sql` — `user_approvals` is dropped in Phase 0; remove/By-pass assertions about it (note: the approval flow is replaced by invitations in Phase 1). If this file's primary purpose was approvals, reduce its `plan(N)` accordingly and leave a comment pointing to Phase 1's invitation tests.
- `reference_tables.sql` — `app_settings` write stays admin-only (`write_role=admin`), so its assertions hold; `casts/skills/...` stay member-read + producer-write, so they hold once memberships replace roles.
- `chats.sql` / `availability_blocked_dates.sql` / `offer_engine_tables.sql` — should pass once memberships replace roles, because the self/participant policies were re-created in Task 0.3.

- [ ] **Step 4: Run the FULL suite — everything green**

Run: `supabase db reset && supabase test db`
Expected: PASS for every file, including `org_helpers_and_platform.sql`, `org_coverage.sql`, `org_isolation.sql`, and all migrated legacy tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests
git commit -m "migrate remaining db tests to org_memberships model" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 0.6: Regenerate types, confirm the app still builds, document the super-admin seed

**Files:**
- Modify (generated): `src/integrations/supabase/types.ts`
- Create: `docs/superpowers/plans/phase-0-operator-notes.md`

- [ ] **Step 1: Regenerate Supabase types**

Run: `supabase gen types typescript --local > src/integrations/supabase/types.ts`
(Or, if using the MCP, call `generate_typescript_types` and write the result to that path.)
Expected: the file now includes `organizations`, `platform_admins`, `org_memberships`, `org_invitations`, and an `org_id` field on the tenant tables; `user_roles` is gone.

- [ ] **Step 2: Confirm the frontend still compiles and unit tests pass**

Run: `npm run lint && npm test && npm run build`
Expected: all pass. The app is org-unaware but functional: queries omit `org_id` (DEFAULT routes inserts to bootstrap), and any logged-in user enrolled in the bootstrap org sees bootstrap data. TypeScript tolerates the new non-optional `org_id` on Row types because reads don't construct rows and inserts rely on the DB default.

> If `tsc`/`vitest` flags a required `org_id` on an `Insert` type at a call site, add `org_id` is **not** required on Insert because of the column DEFAULT — Supabase marks defaulted columns optional on Insert. If a generated Insert type still requires it, that means the DEFAULT didn't apply; re-check Task 0.2.

- [ ] **Step 3: Write operator notes for the real (non-local) environment**

Create `docs/superpowers/plans/phase-0-operator-notes.md`:

```markdown
# Phase 0 — operator notes (real Supabase project)

After these migrations are pushed to the hosted project:

1. **Make yourself the super-admin** (one-off, not in a committed migration since the
   user id is environment-specific):
   ```sql
   insert into public.platform_admins (user_id)
   values ('<your-auth-user-id>')
   on conflict do nothing;
   ```
2. **The bootstrap org** (`00000000-0000-0000-0000-00000000b007`) holds all pre-Phase-1
   data and every existing member. It is a scaffold; Phase 1 introduces real org
   provisioning and removes the column DEFAULTs so future inserts must set org_id.
3. **Platform-default settings** are the `app_settings` rows with `org_id IS NULL`.
   Per-org overrides are added in Phase 2.
4. Nothing here grants god-mode an audit trail — that is the accepted risk recorded in
   spec §12.
```

- [ ] **Step 4: Final Phase-0 verification**

Run: `supabase db reset && supabase test db && npm run lint && npm test && npm run build`
Expected: every gate green — the Phase 0 exit criteria from spec §11 (isolation suite + coverage test green; app still builds on the bootstrap org).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts docs/superpowers/plans/phase-0-operator-notes.md
git commit -m "regenerate types for org model; phase-0 operator notes" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

- **Spec coverage (§11 Phase 0):** platform tables → 0.1; `org_id` everywhere → 0.2; 3 helpers → 0.1; uniform RLS → 0.3; bootstrap org → 0.2; isolation suite + coverage test → 0.2/0.3; "app still builds" → 0.6. ✓
- **Failure-mode coverage:** *data-leak* → `org_isolation.sql` (read + write-side cross-org) + `org_coverage.sql` (no table left unscoped) + default-deny via the catalog-driven drop/recreate. *Migration pain* → DO-loop applies `org_id` uniformly; catalog-driven policy drop avoids hand-listing evolved names; greenfield = no backfill. ✓
- **Type consistency:** helper signatures `is_super_admin(uuid)`, `is_org_member(uuid,uuid)`, `has_org_role(uuid,uuid,app_role)` are identical across the migration and all three new tests. Bootstrap UUID `00000000-0000-0000-0000-00000000b007` is identical across 0.2, 0.4, 0.5, and operator notes. ✓
- **Known intentional behavior change:** uniform `member` read relaxes intra-org booking visibility (Task 0.4 Step 2) — flagged for the executor to confirm rather than silently tighten. `booking_audit_log` stays staff-only via the `staff` read_scope (no regression). ✓
- **Placeholder scan:** no TBD/TODO; every code step has complete SQL/commands. The only "find-and-substitute" notes (constraint names, remaining `user_roles` test files) are guarded by exact discovery commands. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-multi-tenancy-phase-0-foundation.md`. Phases 1–4 will be detailed just-in-time once Phase 0 lands green (per your per-phase slicing choice).

Two execution options for Phase 0:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (using `superpowers:subagent-driven-development`), review between tasks, fast iteration. This fits your "Opus orchestrates, Sonnet/Haiku subagents" intent: Opus reviews each task's diff against this plan; Sonnet executes the SQL/test tasks; Haiku handles the mechanical test-file migrations (0.4/0.5).
2. **Inline Execution** — I execute the tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for your review.

**Which approach?**
