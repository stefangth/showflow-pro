# Harden expire_soft_bookings + should_notify RPC Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. *(This run: executed inline by the orchestrator per owner preference — small, fully-specified diff.)*

**Goal:** Narrow EXECUTE on `public.expire_soft_bookings()` and `public.should_notify(uuid,text,text)` from `authenticated` to `service_role`, closing Open questions #3 and #5 in `docs/system-map.md`.

**Architecture:** One migration (revoke + explicit service_role grant, mirroring the `get_user_id_by_email` precedent from `20260623123352`), grant-posture pgTAP assertions added to the two existing test files, and the system-map maintenance-rule update — all on branch `claude/harden-rpc-grants`, stacked on PR #149 (which introduces the map).

**Tech Stack:** Supabase MCP `apply_migration` (records a real-timestamp version — name the committed file to match), pgTAP `has_function_privilege` (CI-only locally; "red" evidence gathered from prod via read-only `execute_sql`).

## Global Constraints

- Worktree: `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/harden-rpc-grants`, branch `claude/harden-rpc-grants`, base `c837e1e` (stacked on `claude/mystifying-benz-f8fd00` / PR #149).
- Never hand-edit existing files under `supabase/migrations/`; the ONE new migration file must byte-match what `apply_migration` records, with a matching timestamp name.
- pgTAP/vitest/eslint are CI-only in this environment — local "red/green" comes from prod grant-state queries (read-only `has_function_privilege`), full suites run on the PR.
- `docs/system-map.md` MUST be updated in the same PR (its own maintenance rule).
- Commit style: imperative, lowercase, ≤72 chars; `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## Verified caller inventory (pre-implementation research — DONE)

| RPC | caller | client | post-revoke status |
|---|---|---|---|
| `expire_soft_bookings()` | `supabase/functions/expire-offers/index.ts:30` | `admin.rpc(...)` = service-role | keeps working (explicit grant) |
| `expire_soft_bookings()` | frontend `src/` | — | no callers (grep-verified) |
| `should_notify(...)` | `supabase/functions/send-transactional-email/index.ts:116` | `admin.rpc(...)` = service-role | keeps working |
| `should_notify(...)` | `gate_notification_pref()` trigger (`20260622181611`) | SECURITY DEFINER → runs as owner | unaffected by grants |
| `should_notify(...)` | frontend `src/` | — | no callers (prefs UI reads the table under RLS) |

Existing pgTAP behavioral tests (`supabase/tests/rpc/expire_soft_bookings.sql` plan(8), `should_notify.sql` plan(4)) execute as the test superuser — they keep passing after the revoke. `supabase/tests/triggers/notifications_pref_gate.sql` exercises the definer trigger path — unaffected.

---

### Task 1: Failing evidence (red)

- [ ] **Step 1:** Query prod (read-only): `SELECT has_function_privilege('authenticated', 'public.expire_soft_bookings()', 'EXECUTE'), has_function_privilege('authenticated', 'public.should_notify(uuid,text,text)', 'EXECUTE');` — Expected now: `true, true` (the defect).

### Task 2: Write the grant-posture tests (they encode the desired end state)

**Files:** Modify `supabase/tests/rpc/expire_soft_bookings.sql` (plan 8→11), `supabase/tests/rpc/should_notify.sql` (plan 4→7).

- [ ] **Step 1:** Append to `expire_soft_bookings.sql` before `finish()` (and bump `plan(8)`→`plan(11)`):

```sql
-- grant posture: cron-only sweep — clients must go through the expire-offers edge fn
SELECT ok(NOT has_function_privilege('authenticated', 'public.expire_soft_bookings()', 'execute'),
          'authenticated cannot execute');
SELECT ok(NOT has_function_privilege('anon', 'public.expire_soft_bookings()', 'execute'),
          'anon cannot execute');
SELECT ok(has_function_privilege('service_role', 'public.expire_soft_bookings()', 'execute'),
          'service_role can execute');
```

- [ ] **Step 2:** Append to `should_notify.sql` before `finish()` (and bump `plan(4)`→`plan(7)`):

```sql
-- grant posture: no cross-user preference probing — only service_role (and the
-- SECURITY DEFINER gate_notification_pref trigger, which runs as owner) may call it
SELECT ok(NOT has_function_privilege('authenticated', 'public.should_notify(uuid,text,text)', 'execute'),
          'authenticated cannot execute');
SELECT ok(NOT has_function_privilege('anon', 'public.should_notify(uuid,text,text)', 'execute'),
          'anon cannot execute');
SELECT ok(has_function_privilege('service_role', 'public.should_notify(uuid,text,text)', 'execute'),
          'service_role can execute');
```

### Task 3: The migration (green)

- [ ] **Step 1:** Apply via MCP `apply_migration`, name `harden_rpc_grants_service_role_only`, SQL:

```sql
-- Narrow EXECUTE on two automation RPCs flagged by the system-map audit
-- (docs/system-map.md → Open questions #3 and #5, PR #149).
--
-- expire_soft_bookings(): SECURITY DEFINER cross-org sweep with no internal
-- guard; its only real caller is the expire-offers edge fn via the service-role
-- client (supabase/functions/expire-offers/index.ts:30).
-- should_notify(uuid,text,text): SECURITY DEFINER with no self-scope check —
-- authenticated could probe another user's opt-out booleans. Real callers:
-- send-transactional-email (service-role client) and gate_notification_pref()
-- (SECURITY DEFINER trigger fn → executes as owner, unaffected by grants).
--
-- service_role's grant is made explicit (it previously rode on Supabase's
-- default-privileges grant).

revoke execute on function public.expire_soft_bookings() from public, anon, authenticated;
grant execute on function public.expire_soft_bookings() to service_role;

revoke execute on function public.should_notify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.should_notify(uuid, text, text) to service_role;
```

- [ ] **Step 2:** `list_migrations` → copy the recorded version timestamp → save the identical SQL as `supabase/migrations/<version>_harden_rpc_grants_service_role_only.sql`.
- [ ] **Step 3:** Re-run the Task 1 query — Expected: `false, false`; plus `service_role` → `true, true`. Also `SET ROLE authenticated; SELECT public.expire_soft_bookings();` → permission denied (run in one read-only transaction with rollback).

### Task 4: Map + commit + stacked PR

- [ ] **Step 1:** `docs/system-map.md`: rewrite Open questions #3 and #5 as *(fixed — migration `<version>`)*, and update the §5 `expire_soft_bookings` row's guard cell + `should_notify` row.
- [ ] **Step 2:** Commit: `fix: narrow expire_soft_bookings + should_notify grants to service_role`.
- [ ] **Step 3:** Push; `gh pr create --base claude/mystifying-benz-f8fd00` (stacked; retarget to main after #149 merges). PR body: defect, caller inventory, why the trigger path is safe, evidence queries.
- [ ] **Step 4:** Watch CI (pgTAP job) — the two amended test files must pass.

## Self-review

- Spec coverage: both RPCs (T3), test-first analogue (T1 red evidence + T2 tests encode end state), caller verification (done, table above), map maintenance rule (T4), migration conventions (T3 step 2). ✔
- No placeholders; SQL is complete and final. ✔
- Type consistency: signature `public.should_notify(uuid, text, text)` used identically in tests, migration, and queries. ✔
