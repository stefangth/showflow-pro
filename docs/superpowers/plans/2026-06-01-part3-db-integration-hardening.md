# Part 3 — DB + Integration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the database-layer truth gap — regenerate the stale generated types and drop the `as any` workarounds (locally verified), then backfill the highest-risk pgTAP (RLS + RPC + trigger) coverage and expand e2e to the critical cross-stack flows, and add a CI coverage gate. DB/e2e/coverage work is validated through CI (Phase E PR), since this environment has no Docker/Supabase CLI/npm.

**Architecture:**
- **Phase A (locally verifiable, full red→green/build-verified):** regenerate `src/integrations/supabase/types.ts` from the live project via the Supabase MCP tool, then remove the `(... as any)` casts the stale types forced.
- **Phases B–D (CI-validated):** new pgTAP tests, new Playwright specs, and a Vitest coverage gate. These cannot run on this machine (no Docker, no Supabase CLI, no npm) — they are authored by closely following the existing sibling tests and validated in **Phase E** by opening a PR (CI runs the pgTAP/e2e/coverage jobs).

**Execution environment constraints (read first):**
- Vitest runner (no npx/node): `export PATH="$HOME/.deno/bin:$PATH" && deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run <path>`
- Build: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build`
- Lint: `deno run -A --unstable-bare-node-builtins node_modules/.bin/eslint src`
- **No Docker / no Supabase CLI** → `supabase test db` (pgTAP) and `supabase start` cannot run here. pgTAP tests (Phase B) are validated only in CI.
- **No npm/bun/node** → cannot install npm deps or sync `package-lock.json`. The coverage provider dependency (Phase D) must be installed + lockfile-synced in an npm environment; that sub-step is explicitly marked CI/npm-only.
- **Migrations are read-only** (CLAUDE.md): do NOT hand-write files under `supabase/migrations/`. Phase B adds **tests only**, never schema.
- **`types.ts` is auto-generated**: only ever (re)write it via the Supabase MCP `generate_typescript_types` tool — never hand-edit.
- Supabase project id: `epweartpzwvcasrzyueh`.

**Tech Stack:** pgTAP (`supabase/tests/`), Playwright (`e2e/`), Vitest + `@vitest/coverage-v8`, Supabase MCP type generation, GitHub Actions (`.github/workflows/ci.yml`).

---

## File Structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `docs/superpowers/part3-notes.md` | Running notes: regen diff summary, CI-validation checklist, findings | Create |
| `src/integrations/supabase/types.ts` | Regenerated from live schema (via MCP tool only) | Modify (regenerate) |
| `src/components/availability/AvailabilityPicker.tsx` | Drop `blocked_dates` `as any` casts | Modify |
| `src/pages/AvailabilityPage.tsx` | Drop `blocked_dates` `as any` casts | Modify |
| `src/pages/SettingsPage.tsx` | Drop `cast_city_priority` + `show_assignments` `as any` casts | Modify |
| `supabase/tests/rls/availability_blocked_dates.sql` | pgTAP: blocked_dates RLS (artist-self isolation) | Create |
| `supabase/tests/rls/offer_engine_tables.sql` | pgTAP: cast_city_priority + show_date_offer_tiers + show_date_cast_eligibility RLS | Create |
| `supabase/tests/rls/reference_tables.sql` | pgTAP: casts/cast_members/skills/artist_skills/app_settings RLS | Create |
| `supabase/tests/rpc/expire_soft_bookings.sql` | pgTAP: offer-expiry RPC | Create |
| `supabase/tests/rpc/resolve_show_assignments.sql` | pgTAP: producer-routing specificity RPC | Create |
| `supabase/tests/triggers/recompute_and_timestamps.sql` | pgTAP: settings/show recompute triggers + update_updated_at_column | Create |
| `e2e/helpers/eligibility.ts` | Helpers for cast/eligibility seeding | Create |
| `e2e/eligibility-gating.spec.ts` | e2e: eligibility gates who gets offered | Create |
| `e2e/chat-access-control.spec.ts` | e2e: chat participation gating per show-date | Create |
| `vitest.config.ts` | Add scoped `coverage` block + thresholds | Modify |
| `.gitignore` | Ignore `coverage/` | Modify |
| `package.json` | Add `@vitest/coverage-v8` devDep (npm-env step) | Modify |
| `package-lock.json` | Lockfile sync for the new devDep (npm-env step) | Modify |
| `.github/workflows/ci.yml` | Run coverage in the unit-tests job | Modify |

---

## Phase A — Regenerate types + drop `as any` (LOCAL, fully verified)

### Task 0: Create the Part 3 notes file

**Files:** Create `docs/superpowers/part3-notes.md`

- [ ] **Step 1: Create the notes skeleton**

```markdown
# Part 3 — DB + Integration Hardening — Notes

## types.ts regeneration (Phase A)
- (to be filled: tables/columns added by the regen, any app type breakage + fixes)

## CI-validation checklist (Phases B–D, verified via the Phase E PR)
- [ ] pgTAP: availability_blocked_dates.sql
- [ ] pgTAP: offer_engine_tables.sql
- [ ] pgTAP: reference_tables.sql
- [ ] pgTAP: expire_soft_bookings.sql
- [ ] pgTAP: resolve_show_assignments.sql
- [ ] pgTAP: recompute_and_timestamps.sql
- [ ] e2e: eligibility-gating.spec.ts
- [ ] e2e: chat-access-control.spec.ts
- [ ] coverage gate green in CI

## Findings / bugs
- (none yet)
```

- [ ] **Step 2: Commit** — `git add docs/superpowers/part3-notes.md && git commit -m "add part 3 db hardening notes"`

---

### Task 1: Regenerate `src/integrations/supabase/types.ts` from the live schema

**Files:** Modify `src/integrations/supabase/types.ts` (regenerate — never hand-edit)

> This task uses the Supabase MCP tool and must be run by the **controller** (the MCP tool is not available to subagents). The controller performs the regeneration, writes the file, then hands verification to a subagent.

- [ ] **Step 1: Capture the current state** — record current line count and confirm the four booking offer columns are absent:

```bash
cd "/Users/stefanschaal/Claude Code/showflow-pro"
wc -l src/integrations/supabase/types.ts
grep -c "offered_at\|offer_tier\|offer_expires_at\|digest_sent_at" src/integrations/supabase/types.ts   # expect 0
```

- [ ] **Step 2: Generate types via MCP** — call `mcp__6fbecca6-…__generate_typescript_types` with `{ project_id: "epweartpzwvcasrzyueh" }`. The tool returns the full TypeScript source. Write it verbatim to `src/integrations/supabase/types.ts` (preserve the file's existing header/import style if the tool omits it — match what the current file has).

- [ ] **Step 3: Diff-review the regen** — confirm it is additive/corrective, not destructive:

```bash
git diff --stat src/integrations/supabase/types.ts
grep -n "offered_at\|offer_tier\|offer_expires_at\|digest_sent_at" src/integrations/supabase/types.ts   # now present on bookings
grep -nE "blocked_dates|cast_city_priority|show_assignments|show_date_offer_tiers|show_date_cast_eligibility" src/integrations/supabase/types.ts | head
```

Record in `docs/superpowers/part3-notes.md` which tables/columns appeared. If the regen *removes* a table or column the app currently uses, STOP and investigate (the local migrations may lag the live DB) — do not paper over it.

- [ ] **Step 4: Verify the app still type-checks, tests pass, build is clean**

```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
deno run -A --unstable-bare-node-builtins node_modules/.bin/eslint src
```

Expected: 140 Vitest pass, build OK, 0 lint errors. If the richer types surface NEW type errors in app code (likely where code previously leaned on the loose stale types), fix them minimally at the call site — do NOT loosen types with new `as any`. If a fix is non-trivial, report it as DONE_WITH_CONCERNS.

- [ ] **Step 5: Commit** — `git add src/integrations/supabase/types.ts docs/superpowers/part3-notes.md && git commit -m "regenerate supabase types from live schema"`

---

### Task 2: Drop the `as any` casts the stale types forced

**Files:** Modify `src/components/availability/AvailabilityPicker.tsx`, `src/pages/AvailabilityPage.tsx`, `src/pages/SettingsPage.tsx`

**Context:** These files used `(supabase as any).from('blocked_dates'|'cast_city_priority'|'show_assignments')` only because those tables were missing from `types.ts`. After Task 1 they are typed. Remove the casts so the queries are type-checked.

- [ ] **Step 1: Locate every workaround cast**

```bash
cd "/Users/stefanschaal/Claude Code/showflow-pro"
grep -rn "as any" src/components/availability/AvailabilityPicker.tsx src/pages/AvailabilityPage.tsx src/pages/SettingsPage.tsx
```

- [ ] **Step 2: Remove the casts for the now-typed tables.** For each `(supabase as any).from('blocked_dates')` / `'cast_city_priority'` / `'show_assignments'`, change it to `supabase.from('<table>')`. Leave untouched any `as any` that exists for a different reason (e.g. joined-row shaping, `(err: any)`). If removing a cast surfaces a real column-name/type mismatch, that is a latent bug — note it in `part3-notes.md` and fix the query to match the actual schema (do not re-add `as any`).

- [ ] **Step 3: Verify**

```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
deno run -A --unstable-bare-node-builtins node_modules/.bin/eslint src
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run
```

Expected: build clean (no new TS errors), lint not worse than before, Vitest still 140 pass. The diff should *reduce* the `no-explicit-any` warning count.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "drop as-any casts now that blocked_dates/cast_city_priority/show_assignments are typed"`

---

## Phase B — pgTAP gap-fill (CI-validated)

> **For every Phase B task:** READ the sibling reference tests first — `supabase/tests/rls/bookings_and_audit.sql`, `supabase/tests/rls/chats.sql`, `supabase/tests/rpc/decide_user_approval.sql`, `supabase/tests/triggers/compute_show_date_status.sql`. Match their exact structure: `BEGIN; SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`, the helper pattern they use to create auth users / set `request.jwt.claims` / `SET LOCAL role`, and the `tests.` helpers if present. Use the SAME role-switching idiom they use to assert RLS as a given user. Author tests that assert the behaviors listed; do not invent schema. These cannot be run locally (no Docker) — self-review against the reference files, then they are validated in CI (Phase E). State this CI-validation caveat in your report.

### Task 3: RLS — availability / blocked_dates self-isolation

**Files:** Create `supabase/tests/rls/availability_blocked_dates.sql`

- [ ] **Step 1:** Read `supabase/tests/rls/bookings_and_audit.sql` to copy the user-seeding + role-switch idiom and the `app_settings`/fixture setup style.
- [ ] **Step 2:** Write a pgTAP test asserting:
  - An artist can `INSERT`/`SELECT`/`DELETE` their **own** `blocked_dates` rows.
  - An artist **cannot** `SELECT` or modify **another** artist's `blocked_dates` rows (the central data-exposure guard).
  - Admin and producer **can** `SELECT` all `blocked_dates`.
  - An unauthenticated/`anon` role gets nothing.
  - (If the table is named `available_dates` instead, test that one; confirm the real table name from the regenerated `types.ts` / migrations.)
- [ ] **Step 3:** Self-review structure vs the reference file (correct `plan(N)` count, balanced `BEGIN/ROLLBACK`, every assertion has a description). 
- [ ] **Step 4:** Tick the row in `part3-notes.md`. Commit: `git add supabase/tests/rls/availability_blocked_dates.sql docs/superpowers/part3-notes.md && git commit -m "pgTAP: blocked_dates RLS self-isolation"`

### Task 4: RLS — offer-engine tables

**Files:** Create `supabase/tests/rls/offer_engine_tables.sql`

- [ ] **Step 1:** Read `supabase/tests/rls/chats.sql` (it exercises a participation-gated table — closest analog).
- [ ] **Step 2:** Write pgTAP asserting RLS on:
  - `cast_city_priority`: admin/producer full CRUD; artist **cannot** read or write (leaks booking-priority strategy).
  - `show_date_offer_tiers`: artists may `SELECT`; only admin/producer may `INSERT/UPDATE/DELETE`.
  - `show_date_cast_eligibility`: authenticated may `SELECT`; only admin/producer may `INSERT/DELETE`.
- [ ] **Step 3:** Self-review vs reference. **Step 4:** tick notes; commit `pgTAP: offer-engine tables RLS`.

### Task 5: RLS — reference/config tables

**Files:** Create `supabase/tests/rls/reference_tables.sql`

- [ ] **Step 1:** Read `supabase/tests/rls/notifications_roles_approvals.sql`.
- [ ] **Step 2:** Write pgTAP asserting: `casts`, `cast_members`, `skills`, `artist_skills` — all authenticated may `SELECT`, only admin/producer may write; `app_settings` — authenticated may `SELECT`, only **admin** may write (per CLAUDE.md). Assert an artist write is denied for each.
- [ ] **Step 3:** Self-review. **Step 4:** tick notes; commit `pgTAP: reference/config tables RLS`.

### Task 6: RPC — expire_soft_bookings

**Files:** Create `supabase/tests/rpc/expire_soft_bookings.sql`

- [ ] **Step 1:** Read `supabase/tests/rpc/decide_user_approval.sql` + `supabase/tests/triggers/compute_show_date_status.sql` (for booking fixture setup).
- [ ] **Step 2:** Seed bookings with `status='suggested'`/`'soft_booked'` and varied `offer_expires_at` (past, future, null). Call `SELECT expire_soft_bookings();` and assert: past-expiry rows become `cancelled` with the expected `cancellation_reason`; future-expiry and null-expiry rows are untouched; `confirmed` rows are never cancelled; `updated_at` advanced on changed rows only.
- [ ] **Step 3:** Self-review. **Step 4:** tick notes; commit `pgTAP: expire_soft_bookings RPC`.

### Task 7: RPC — resolve_show_assignments specificity

**Files:** Create `supabase/tests/rpc/resolve_show_assignments.sql`

- [ ] **Step 1:** Inspect the `show_assignments` migration + the function body (find via `grep -rn "resolve_show_assignments" supabase/migrations`).
- [ ] **Step 2:** Seed `show_assignments` rows at different specificities (program-only; program+sub_program; program+sub_program+city) for distinct producers. Call `resolve_show_assignments(program, sub_program, city_id)` and assert the **most specific** match wins; deleting it falls back to the next; no match → empty set; NULL sub_program/city handled as the function intends.
- [ ] **Step 3:** Self-review. **Step 4:** tick notes; commit `pgTAP: resolve_show_assignments specificity`.

### Task 8: Triggers — recompute cascades + updated_at

**Files:** Create `supabase/tests/triggers/recompute_and_timestamps.sql`

- [ ] **Step 1:** Read `supabase/tests/triggers/compute_show_date_status.sql`.
- [ ] **Step 2:** Assert: (a) updating `app_settings.sub_program_slots_defaults` recomputes affected `show_dates.status` (the `sync_show_dates_on_settings_update` trigger); (b) updating a `shows.program`/`sub_program` recomputes its dates (`sync_show_dates_on_show_update`); (c) `update_updated_at_column()` advances `updated_at` on `UPDATE` for a representative table and does not fire spuriously. Keep `plan(N)` accurate.
- [ ] **Step 3:** Self-review. **Step 4:** tick notes; commit `pgTAP: recompute cascades + updated_at trigger`.

---

## Phase C — e2e expansion (CI-validated)

> READ `e2e/booking-lifecycle.spec.ts`, `e2e/global-setup.ts`, `e2e/playwright.config.ts`, and ALL of `e2e/helpers/*` first. Reuse `adminClient()`, the auth helpers, and the booking-seeding helpers. Match the existing spec style (test.describe, fixture seed in `beforeAll`, cleanup in `afterAll`, polling helpers). Not runnable locally (no browsers/backend) — validated in CI Phase E.

### Task 9: e2e — eligibility gating

**Files:** Create `e2e/helpers/eligibility.ts`, `e2e/eligibility-gating.spec.ts`

- [ ] **Step 1:** Read the existing helpers; identify what booking-fixture seeding already provides and what's missing for cast/eligibility (cast, cast_members, show_cast_eligibility, show_date_cast_eligibility).
- [ ] **Step 2:** Add `e2e/helpers/eligibility.ts` with declarative seed/cleanup for cast + membership + eligibility rows (FK-ordered cleanup, mirroring `booking.ts`).
- [ ] **Step 3:** Write `eligibility-gating.spec.ts`: seed an eligible artist → invoke `open-offer-tier` (tier 99) → assert the artist gets a `suggested` booking; remove the `show_date_cast_eligibility` row (or cast membership) → invoke again for a fresh date → assert the artist is NOT offered. Use DB assertions via `adminClient()` like `booking.ts` does.
- [ ] **Step 4:** Self-review vs `booking-lifecycle.spec.ts`. Tick notes; commit `e2e: eligibility gating`.

### Task 10: e2e — chat access-control

**Files:** Create `e2e/chat-access-control.spec.ts`

- [ ] **Step 1:** Reuse booking + auth helpers. Seed a date with one `soft_booked` artist (participant) and one `suggested` artist (non-participant).
- [ ] **Step 2:** Assert via UI: the participant can open the show-date chat and post a message; the non-participant cannot see/access the chat. Then cancel the participant's booking and assert they lose chat access. (Keep to behaviors the UI actually exposes; if a step isn't reachable via UI, assert the underlying `is_chat_participant`/RLS via `adminClient()`.)
- [ ] **Step 3:** Self-review. Tick notes; commit `e2e: chat access-control`.

---

## Phase D — CI coverage gate (CI/npm-validated)

### Task 11: Configure Vitest coverage scope + thresholds (local — config only)

**Files:** Modify `vitest.config.ts`, `.gitignore`

- [ ] **Step 1:** Add a `coverage` block to the `test` config in `vitest.config.ts`:

```ts
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/components/ui/**",          // shadcn primitives — generated
        "src/integrations/supabase/types.ts", // auto-generated
        "src/**/*.d.ts",
        "src/main.tsx",
      ],
      thresholds: {
        // Conservative starting gate — ratchet up over time, never down.
        statements: 25,
        branches: 60,
        functions: 40,
        lines: 25,
      },
    },
```

Note: thresholds are intentionally low because most production code isn't unit-covered yet (the data/lib layers are; pages/components largely aren't). The gate exists to prevent *regression*; tune upward in a later cycle.

- [ ] **Step 2:** Add `coverage/` to `.gitignore` (the report directory must never be committed).
- [ ] **Step 3 (local sanity):** the `@vitest/coverage-v8` provider is NOT in the committed deps yet, so a local `--coverage` run will report a missing dependency — that's expected and is resolved in Task 12. Confirm the config at least parses by running a normal (non-coverage) test run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/bookings.test.ts` (should still pass).
- [ ] **Step 4:** Commit `git add vitest.config.ts .gitignore && git commit -m "configure scoped vitest coverage + thresholds"`

### Task 12: Add coverage provider dep + CI job (REQUIRES an npm environment)

**Files:** Modify `package.json`, `package-lock.json`, `.github/workflows/ci.yml`

> **This task cannot be completed on the planning machine** (no npm to sync `package-lock.json`; committing a `package.json`-only dep would break every `npm ci` CI job). It must be run where `npm` exists — either by the user locally or as the first commit of the Phase E PR branch in an npm-capable checkout.

- [ ] **Step 1:** `npm install -D @vitest/coverage-v8@^3.2.4` (pin to match the installed `vitest ^3.2.4`). This updates BOTH `package.json` and `package-lock.json`.
- [ ] **Step 2:** In `.github/workflows/ci.yml`, change the unit-tests job's test step from `npm test` to also produce coverage and enforce the gate, e.g. `run: npm run test:coverage` (the existing `test:coverage` script is `vitest run --coverage`; the thresholds from Task 11 make it fail-on-regression).
- [ ] **Step 3:** Verify in CI that the coverage job runs and passes the thresholds. If thresholds are too high for current reality, lower them to just under the actual measured numbers (never disable the gate).
- [ ] **Step 4:** Commit `git add package.json package-lock.json .github/workflows/ci.yml && git commit -m "add coverage provider and enforce coverage gate in CI"`

---

## Phase E — Wrap & CI validation

### Task 13: Open the validation PR and drive CI green

- [ ] **Step 1:** Ensure Phase A is committed and `dev` build/lint/Vitest are green locally.
- [ ] **Step 2:** Push `dev` and open a PR to `main` (this triggers the full CI matrix incl. pgTAP DB tests, Deno function tests, Playwright e2e, and the coverage gate):

```bash
git push origin dev
gh pr create --base main --head dev --title "Part 3 — DB + integration hardening" --body "$(cat <<'EOF'
## Summary
- Regenerate generated Supabase types; drop as-any workarounds (verified locally)
- Backfill highest-risk pgTAP: RLS (blocked_dates, offer-engine tables, reference tables), RPC (expire_soft_bookings, resolve_show_assignments), recompute/updated_at triggers
- Expand e2e: eligibility gating, chat access-control
- Add scoped Vitest coverage gate

## Test Plan
- [ ] CI: lint, Vitest+coverage, pgTAP, Deno functions, Playwright e2e all green
EOF
)"
```

- [ ] **Step 3:** Watch CI (`gh pr checks --watch`). For each failing pgTAP/e2e job, read the logs (the CI workflow dumps pgTAP output + container/preview logs on failure), fix the offending test (or, if a test exposed a real DB/app bug, record it in `part3-notes.md` and decide fix-vs-characterize per the Part 1/2 protocol), push, and re-watch. Iterate until all jobs are green.
- [ ] **Step 4:** Fill in the regen diff summary + tick the CI-validation checklist in `docs/superpowers/part3-notes.md`. Commit `git add docs/superpowers/part3-notes.md && git commit -m "finalize part 3 notes; CI matrix green"` and push.

---

## Self-Review (completed by plan author)

**1. Roadmap coverage** (Part 3 = "pgTAP gap-fill; e2e expansion; CI coverage gate; regenerate stale types.ts"):
- regenerate stale `types.ts` → Task 1 (+ Task 2 drops the casts it enables). ✅
- pgTAP gap-fill → Tasks 3–8 (RLS data-exposure + booking-engine RPCs + recompute triggers, risk-ranked). ✅
- e2e expansion → Tasks 9–10 (eligibility gating + chat access-control, the two highest-value flows). ✅
- CI coverage gate → Tasks 11–12. ✅

**2. Verifiability honesty:** Phase A is fully locally verified (build/lint/Vitest). Phases B–D are explicitly CI-validated via the Phase E PR because this machine lacks Docker/Supabase CLI/npm — stated up front and per task. The coverage dep's npm requirement is called out as a hard environment boundary, not glossed.

**3. No forbidden actions:** no hand-edited migrations; `types.ts` only regenerated via the MCP tool; no new `as any`; audit/log tables untouched; coverage report gitignored.

**4. Consistency:** table/RPC names (`blocked_dates`, `cast_city_priority`, `show_assignments`, `show_date_offer_tiers`, `show_date_cast_eligibility`, `expire_soft_bookings`, `resolve_show_assignments`) match the gap analysis and migration list. Coverage script `test:coverage` already exists in `package.json`.

**Deferred (not in Part 3):** raising coverage thresholds after backfilling component/page tests; the remaining medium-risk pgTAP (handle_new_user signup trigger, full reference-table matrix); e2e for offer-expiry + producer-routing (candidates 2 & 4 from the gap analysis) — fast-follow once the harness helpers from Tasks 9–10 exist.
