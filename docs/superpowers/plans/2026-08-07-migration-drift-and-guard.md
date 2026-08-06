# Migration Drift Repair + Version-Aware Guard + Seed Fixture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic migration deploys to production (broken since 2026-07-23), and make the class of failure that broke them impossible to miss again.

**Architecture:** Production's `supabase_migrations.schema_migrations` holds 9 rows whose `version` differs from the repo filename that produced them, because they were applied with the Supabase MCP `apply_migration` (which stamps its own timestamp) rather than by the merge. `supabase db push` aborts wholesale when the remote history contains a version with no local file, so the Supabase GitHub integration has applied nothing to prod since the first drift. We realign by **renaming the 9 repo files** to the versions production actually recorded (no production write, matching the precedent set in `ef42924`), then upgrade the existing CI guard from name-only to version-aware so any future drift fails a PR on the day it appears. A synthetic `supabase/seed.sql` makes a freshly-migrated database usable, which is what preview branches and `supabase db reset` need.

**Tech Stack:** Supabase CLI 2.98.2, GitHub Actions, Node 20/22, Vitest, Postgres 17.

## Global Constraints

- Migration files under `supabase/migrations/` are otherwise **read-only** — this plan renames them and edits no SQL body except comment references.
- Production project ref: `epweartpzwvcasrzyueh`. No writes to production in this plan.
- No Docker Desktop on the authoring machine, so `supabase start` / `supabase db reset` cannot run locally. Seed SQL is validated against the real schema in a rolled-back transaction, and end-to-end by the PR's preview branch.
- `npm run lint` is a zero-warning gate; `any` is banned.
- Seed data must contain **no personal data** — synthetic names and `@example.com` addresses only.
- Product-facing copy must not use em or en dashes.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/*.sql` (9) | Rename | Filename version must equal the version recorded in production |
| `supabase/migrations/20260728194208_cron_health_scan_volatile_again.sql` | Modify (comments) | Two comment lines reference a renamed file |
| `scripts/check-migrations.mjs` | Modify | Three-way comparison: missing, orphan, version mismatch |
| `scripts/check-migrations.test.mjs` | Modify | Unit coverage for the new comparison |
| `.github/workflows/check-migrations.yml` | Modify | Add `pull_request` trigger so the guard blocks a merge |
| `.github/workflows/deploy-functions.yml` | Modify | Run the guard before deploying; drop the stale `db-reset-production` references |
| `.github/workflows/db-reset-production.yml` | Delete | One-click production wipe, premise no longer true |
| `supabase/seed.sql` | Create | Deterministic local/preview fixture |
| `CLAUDE.md` | Modify | State the single-writer rule explicitly |

---

### Task 1: Realign the 9 drifted migration filenames

The 9 pairs, verified against production on 2026-08-07:

| Name | Repo filename version | Recorded in production |
|---|---|---|
| platform_audit_log | 20260723002807 | 20260723002902 |
| platform_membership_rpcs | 20260723003210 | 20260723003308 |
| platform_link_artist_rpc | 20260723003453 | 20260723003543 |
| email_health_event_window | 20260723213733 | 20260723213921 |
| email_health_latest_lifecycle_event | 20260723225000 | 20260723215420 |
| cron_stagger_and_timeout | 20260728131500 | 20260728135342 |
| cron_health_scan_answered | 20260728132500 | 20260728144736 |
| cron_health_observation_key | 20260728133500 | 20260728145106 |
| health_daily_monotonic_upsert | 20260804184500 | 20260804184302 |

Every rename preserves relative ordering against its neighbours (checked pairwise), so replay order is unchanged.

**Files:**
- Rename: the 9 files above
- Modify: `supabase/migrations/20260728194208_cron_health_scan_volatile_again.sql` (lines 9 and 15 name `20260728132500_cron_health_scan_answered.sql`)

- [ ] **Step 1: Rename with `git mv`** so history follows the file.
- [ ] **Step 2: Update the two comment references** to `20260728144736`.
- [ ] **Step 3: Verify the diff is rename-only** — `git diff --cached -M --stat` must show 9 pure renames plus one comment-only edit, and `git diff --cached -M -- 'supabase/migrations/*.sql' | grep '^[+-][^+-]'` must show only the two comment lines.
- [ ] **Step 4: Verify replay order is unchanged** — the sorted filename list before and after must differ only by the 9 substitutions, with no element crossing a neighbour.
- [ ] **Step 5: Commit** `realign nine migration filenames with their applied versions`.

### Task 2: Make the guard version-aware and PR-blocking

`diffMigrations(repoNames, appliedNames)` compares by name only, which is precisely the property drift preserves — it stayed green through every failed deploy. Replace it with a three-way comparison keyed on name.

**Files:**
- Modify: `scripts/check-migrations.mjs`
- Test: `scripts/check-migrations.test.mjs`
- Modify: `.github/workflows/check-migrations.yml`

**Interfaces:**
- Produces: `parseMigrationFilename(filename) -> {version, name}`, and
  `compareMigrations(repoMigrations, appliedMigrations) -> {missing[], orphaned[], mismatched[]}`
  where each input is an array of `{version, name}` and `mismatched` entries are
  `{name, repoVersion, appliedVersion}`.
- `repoNameFromFilename` is retained (re-exported from `parseMigrationFilename`) so existing callers and tests keep working.

- [ ] **Step 1: Write the failing tests** covering: clean parity returns three empty arrays; a repo name absent from production lands in `missing`; an applied name with no repo file lands in `orphaned`; a name present on both sides with different versions lands in `mismatched` and NOT in missing/orphaned; the current production drift (9 pairs) produces exactly 9 mismatches and no missing/orphaned.
- [ ] **Step 2: Run the tests and watch them fail** — `npx vitest run scripts/check-migrations.test.mjs`.
- [ ] **Step 3: Implement `parseMigrationFilename` and `compareMigrations`**, and rewrite `main()` to fetch `version, name` (not just `name`) and report all three categories with actionable remediation text.
- [ ] **Step 4: Run the tests and watch them pass.**
- [ ] **Step 5: Add the `pull_request` trigger** to `check-migrations.yml`, keeping `push: main` as the post-merge alarm. Drop the `paths:` filter on the PR trigger — a drift introduced by an out-of-band apply has no migration file in the diff, so a path filter would skip exactly the case we care about.
- [ ] **Step 6: Commit** `make the migration guard compare versions, not just names`.

### Task 3: Gate the edge-function deploy on the guard

Functions and frontend currently ship on merge whether or not the schema landed. That is the failure mode that broke multi-date hire orders on 2026-07-24.

**Files:**
- Modify: `.github/workflows/deploy-functions.yml`

- [ ] **Step 1: Add a `Verify migrations are applied` step** running `node scripts/check-migrations.mjs` before `supabase functions deploy`, guarded by the same `steps.changed.outputs.deploy == 'true'` condition, with `SUPABASE_PROJECT_REF` in the job env. It needs `actions/setup-node@v4`.
- [ ] **Step 2: Fix the two stale `db-reset-production` comment references** (lines 31 and 105) since Task 6 deletes that workflow.
- [ ] **Step 3: Commit** `block the function deploy when a migration has not been applied`.

### Task 4: Add the synthetic seed fixture

Preview branches come up `with_data: false`, and onboarding is invite-only with no signup form, so a fresh database cannot be logged into at all. The seed makes a migrated database usable.

Facts the seed must respect, verified in the schema:
- The **bootstrap org** `00000000-0000-0000-0000-00000000b007` already exists (created by `20260603120100_add_org_id_to_tenant_tables.sql`) and is the `org_id` default on every tenant table.
- Access is an `org_memberships` row `(org_id, user_id, role)`; super-admin is a `platform_admins` row.
- `handle_new_user` creates the profile from an `auth.users` insert.
- `pgcrypto` lives in the `extensions` schema, so password hashing must be called as `extensions.crypt(...)` / `extensions.gen_salt('bf')`.
- Fixed UUIDs throughout, and every statement idempotent (`on conflict do nothing`), so a re-run is a no-op.

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 1: Write the seed** — four users (super-admin, admin, producer, artist) at `@example.com` with password `showflow-dev`, their memberships, one city, one cast, two shows, three show dates. No bookings and no hire orders, so no notification or dispatch trigger fires during seeding.
- [ ] **Step 2: Validate against the real schema in a rolled-back transaction** — run the file via `execute_sql` wrapped in `begin; … rollback;` so it exercises every constraint and trigger and persists nothing.
- [ ] **Step 3: Commit** `add a synthetic seed fixture for local and preview databases`.

### Task 5: State the single-writer rule

**Files:**
- Modify: `CLAUDE.md` (Database changes section)

- [ ] **Step 1: Replace the vague guidance** with: the merge to `main` applies migrations; do not apply to production by hand; if an out-of-band apply is unavoidable, rename the file to the version that was recorded, in the same commit. Note that the guard now enforces this.
- [ ] **Step 2: Commit** `document the single-writer rule for migrations`.

### Task 6: Delete the production DB-reset workflow

Its own header says it is safe "only because it is greenfield (no operational data)", which stopped being true, and the divergence it was built to work around is what Task 1 fixes.

**Files:**
- Delete: `.github/workflows/db-reset-production.yml`

- [ ] **Step 1: Delete the file.**
- [ ] **Step 2: Commit** `remove the one-click production database reset`.

### Task 7: Verify and open the PR

- [ ] **Step 1:** `npm run lint`
- [ ] **Step 2:** `npx vitest run scripts/`
- [ ] **Step 3:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.tools.json --noEmit`
- [ ] **Step 4:** `npm run sync:mirrors:check`
- [ ] **Step 5:** Push and open the PR. The PR's own `check-migrations` run is the live proof: it must pass **only after** Task 1's renames, and the preview branch build is the end-to-end proof of the seed.

---

## Verification of the outcome

The fix is confirmed when the **"Supabase Preview" check on the merge commit to `main`** reports success against `epweartpzwvcasrzyueh`, and the `main` branch row in `list_branches` leaves `MIGRATIONS_FAILED`. Neither can be observed before the merge, so the PR reports "expected to resolve", not "resolved".
