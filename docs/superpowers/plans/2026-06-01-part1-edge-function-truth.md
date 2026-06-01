# Part 1 — Edge-Function Truth + Bug Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the smoke-level edge-function tests with deep DI tests that assert *correct* behavior per `docs/app-logic.md`, surface the bugs those tests expose, and fix each bug regression-test-first.

**Architecture:** Build on Part 0's `handle(req, deps)` + `makeFakeDeps()` seam. First upgrade the fake clients so a single table can return *different* results for *different* queries (needed for multi-query handlers), and inject the remaining clocks. Then, per function (booking-engine first), write a comprehensive DI test suite that encodes the documented contract; every failing assertion is triaged as a real bug (fix it, with the failing test as its regression test) or intentional-but-undocumented behavior (lock it with a characterization test + note).

**Tech Stack:** Deno test (edge functions), TypeScript, Supabase JS v2.

**Branch:** `dev`. **Spec:** `docs/superpowers/specs/2026-06-01-testability-foundation-part0-design.md` (§2 roadmap, §5 methodology). **Domain contract:** `docs/app-logic.md`.

---

## Bug-handling protocol (READ FIRST — applies to every Phase 2–4 task)

When a deep-test assertion (written to match `docs/app-logic.md`) does **not** pass against the real handler, the implementer must classify it:

1. **Real bug** (handler violates the documented contract): keep the failing test as the regression test, fix the handler minimally, re-run until green. If the fix belongs in the **database** (a trigger/RLS/RPC, not the edge function), DO NOT edit migrations — instead write the failing test as `Deno.test.ignore(...)` with a `// BUG(db): ...` comment and add the item to the **Bug Log** (below). Report it as `DONE_WITH_CONCERNS`.
2. **Intentional-but-undocumented** (handler behavior is defensible, doc is silent/wrong): change the test to assert the *actual* behavior, add a `// characterization: <why>` comment, and note it in the Bug Log as a doc-gap.
3. **Ambiguous** (can't tell if the behavior is a bug): do NOT guess. Leave the assertion as `Deno.test.ignore` with a `// QUESTION: ...` comment, note it in the Bug Log, and report `DONE_WITH_CONCERNS` so the controller escalates to the human.

**Never** weaken a test just to make it pass. A green suite that doesn't assert the contract is the exact failure Part 0 set out to kill.

### Bug Log
Append findings to `docs/superpowers/part1-bug-log.md` (created in Task 1.0). One row per finding: `| function | severity | contract violated | fix (edge / db-deferred / characterized) | test |`.

---

## Phases

| Phase | Title | Tasks |
|---|---|---|
| 1 | Test-infra upgrades | 1.0 bug log · 1.1 fake-client per-query seeding (Deno) · 1.2 same for frontend · 1.3 inject `now` into webhook/email crypto |
| 2 | Booking-engine deep tests + fixes | 2.1 send-offer-digest · 2.2 expire-offers · 2.3 open-offer-tier · 2.4 tier-at-risk-watcher · 2.5 send-confirmation-digest |
| 3 | Email / webhook / sync deep tests | 3.1 send-transactional-email · 3.2 handle-email-suppression · 3.3 handle-email-unsubscribe · 3.4 airtable-poll |
| 4 | Admin / notify / preview deep tests | 4.1 admin-decide-approval · 4.2 admin-set-role · 4.3 admin-list-users · 4.4 notify-signup · 4.5 preview-transactional-email |
| 5 | Wrap | 5.1 full-suite gate · 5.2 bug-log review + final code review |

Execute in order. Phases 2–4 functions are independent; within a phase, do highest-risk first (order as listed).

---

# PHASE 1 — Test-infra upgrades

### Task 1.0: Create the bug log

**Files:** Create `docs/superpowers/part1-bug-log.md`

- [ ] **Step 1: Create the file**

```markdown
# Part 1 — Bug Log

Findings surfaced by deep edge-function tests. Severity: CRITICAL (data loss / security / silent failure) · HIGH (wrong result for users) · MED · LOW.

| Function | Severity | Contract violated (app-logic.md ref) | Resolution | Test |
|---|---|---|---|---|
| _(none yet)_ | | | | |
```

- [ ] **Step 2: Commit** — `git add docs/superpowers/part1-bug-log.md && git commit -m "docs: add Part 1 bug log"`

---

### Task 1.1: Fake Deno client — per-query result selection

**Problem:** `createFakeClient` (in `supabase/functions/_shared/testing.ts`) returns ONE seeded result per table, so a handler that queries the same table with different filters (e.g. `expire-offers` reads `app_settings` for `cron_secret` AND `sub_program_slots_defaults`) can't be modeled. Add **match-based** seeding while keeping the existing single-result form working.

**Files:**
- Modify: `supabase/functions/_shared/testing.ts`
- Test: `supabase/functions/_shared/testing.test.ts` (extend)

- [ ] **Step 1: Write failing tests** (append to `testing.test.ts`):

```ts
import { createFakeClient } from "./testing.ts";

Deno.test("fake client: array seed returns the entry whose `when` matches the recorded eq() args", async () => {
  const { client } = createFakeClient({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" }, error: null },
        { when: { key: "sub_program_slots_defaults" }, data: { value: { t: {} } }, error: null },
      ],
    },
  });
  const a = await client.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  const b = await client.from("app_settings").select("value").eq("key", "sub_program_slots_defaults").maybeSingle();
  assertEquals(a, { data: { value: "s" }, error: null });
  assertEquals(b, { data: { value: { t: {} } }, error: null });
});

Deno.test("fake client: array seed falls back to an entry with no `when` (default)", async () => {
  const { client } = createFakeClient({
    tables: { bookings: [{ when: { status: "suggested" }, data: [1], error: null }, { data: [], error: null }] },
  });
  const hit = await client.from("bookings").select("*").eq("status", "suggested");
  const miss = await client.from("bookings").select("*").eq("status", "confirmed");
  assertEquals(hit, { data: [1], error: null });
  assertEquals(miss, { data: [], error: null });
});

Deno.test("fake client: single-object seed still works (backward compatible)", async () => {
  const { client } = createFakeClient({ tables: { artists: { data: { id: "a1" }, error: null } } });
  assertEquals(await client.from("artists").select("*").eq("id", "a1").maybeSingle(), { data: { id: "a1" }, error: null });
});
```

- [ ] **Step 2: Run, verify the two new tests FAIL:** `export PATH="$HOME/.deno/bin:$PATH" && deno test --allow-all supabase/functions/_shared/testing.test.ts`

- [ ] **Step 3: Implement match-based seeding.** In `createFakeClient`, change the per-table seed handling so a seed value may be a single `{data,error}` (current) OR an array of `{ when?: Record<string, unknown>, data, error }`. The builder must record `.eq(col, val)` args (it already does), and at terminal/await time pick the array entry whose every `when` key matches a recorded `eq` arg pair for THIS builder; if none match, use the first entry without a `when`; else `{data:[],error:null}`. Implementation sketch (adapt to the existing builder):

```ts
// inside builder(table): collect this builder's own eq-args
const localEq: Record<string, unknown> = {};
// in the `eq` chain method: localEq[String(args[0])] = args[1];  (in addition to global calls.push)
function resolve() {
  const seed = tables[table];
  if (Array.isArray(seed)) {
    const match = seed.find((s) => s.when && Object.entries(s.when).every(([k, v]) => localEq[k] === v));
    if (match) return { data: match.data, error: match.error ?? null };
    const dflt = seed.find((s) => !s.when);
    return dflt ? { data: dflt.data, error: dflt.error ?? null } : { data: [], error: null };
  }
  return seed ?? { data: [], error: null };
}
// single/maybeSingle/then all resolve() instead of reading the static `result`
```
Keep `FakeClientOptions.tables` typed to accept both forms. Update `makeFakeDeps` accordingly (it passes opts through).

- [ ] **Step 4: Run, verify ALL pass** (old + 3 new): `export PATH="$HOME/.deno/bin:$PATH" && deno test --allow-all supabase/functions/_shared/testing.test.ts`

- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/testing.ts supabase/functions/_shared/testing.test.ts && git commit -m "test(functions): add match-based per-query seeding to fake client"`

---

### Task 1.2: Frontend fake client — per-query result selection

Mirror Task 1.1 in `src/test/supabaseFake.ts` (same `when`/array semantics, recording `.eq` args per builder) + extend `src/test/supabaseFake.test.ts` with the analogous 3 tests. Verify with `npx vitest run src/test/supabaseFake.test.ts`. Commit: `test: add match-based per-query seeding to frontend fake supabase`.

*(This unblocks Part 2's frontend hook tests; do it now so both fakes stay in lockstep.)*

---

### Task 1.3: Inject `now` into webhook signature + email idempotency

**Why:** Part 0 left `Date.now()` inside `handle-email-suppression`'s `verifyResendWebhook` (the 5-min replay window) and any clock in `send-transactional-email` un-injected, so the timestamp-tolerance and idempotency paths can't be tested deterministically.

**Files:** `supabase/functions/handle-email-suppression/index.ts`, `supabase/functions/send-transactional-email/index.ts`

- [ ] **Step 1:** In `handle-email-suppression`, thread `deps.now()` into `verifyResendWebhook` — change its signature to accept a `now: number` (epoch ms) or `nowDate: Date` param, pass `deps.now()` from `handle`, and replace the internal `Date.now()` with it. Keep the crypto identical otherwise.
- [ ] **Step 2:** In `send-transactional-email`, replace any remaining `new Date()` with `deps.now()` (the idempotency-key/timestamp paths). Leave `crypto.randomUUID()`/`getRandomValues` as-is (non-deterministic by nature; test around them).
- [ ] **Step 3:** `export PATH="$HOME/.deno/bin:$PATH" && deno check` both files; run their existing smoke tests — still green.
- [ ] **Step 4: Commit** — `git commit -m "refactor(functions): inject deps.now into webhook + email timestamp paths"`

---

# PHASE 2 — Booking-engine deep tests + fixes

> Each task: read the function + the cited `app-logic.md` section, write a deep `index.di.test.ts` (extend the existing one) covering the **Contract** scenarios below using `makeFakeDeps` with match-based seeding and a fixed `now`, then apply the **Bug-handling protocol**. Assert real query/mutation shapes via the recorded `calls` and the `invokeCalls`/`sendEmail` records. Commit per function.

### Task 2.1: `send-offer-digest` (the known atomic-update suspect)

**Contract (`app-logic.md` "The Offer → Booking Flow", "Offer expiry"):**
- Berlin-hour gate: sends only when Berlin local hour == `offer_digest_hour_berlin` (default 19); else `{skipped:true}`. Test with DST: 2026-06-01 (CEST, UTC+2) and a winter date (CET, UTC+1) — assert the gate uses the right local hour both seasons.
- Groups all undigested `suggested` offers by artist; one email per artist; skips artists with no email.
- Includes offers with `digest_sent_at IS NULL` and (`offer_expires_at IS NULL` OR not yet expired).
- Sets `offer_expires_at = now + offer_response_window_hours` (default 48) — the window starts at digest send, NOT offer creation.
- Stamps `digest_sent_at` + `offer_expires_at` on exactly the bookings included for that artist.
- **Atomicity focus:** if `sendEmail` succeeds but the stamp `update` fails, the function logs and continues (does NOT count it) → next run re-sends. **Write a test that injects a stamp-update error** (seed `bookings` update to return `{error}`) **and assert the documented behavior** — then judge: is at-least-once email with possible duplicates acceptable, or a bug? Record the verdict in the bug log. If the idempotency key (`offer-digest-<artist>-<hour>`) is intended to dedupe, assert it's set.

**Steps:** write the deep tests → run → triage per protocol → commit `test(send-offer-digest): deep DI tests + <fix|characterize>`.

### Task 2.2: `expire-offers`

**Contract (`app-logic.md` "Understudy promotion" is DB-side; here test the escalation):**
- Calls `expire_soft_bookings` RPC first; 500 on RPC error.
- For each open, not-yet-escalated tier: escalates only when `pendingNotExpired == 0` AND `accepted < requiredSlots` (`requiredSlots = main_cast + understudies` from slot defaults). Test the **boundary**: an offer expiring exactly at `now` vs one ms in the future (uses `deps.now()` now — deterministic).
- `requiredSlots` unconfigured (no slot default for program/sub_program) → skip (no escalation).
- Recipients: `resolve_show_assignments` RPC producers; empty → fall back to admins. Dedupe.
- Writes one `cast_escalation_requested` notification per recipient; emails each (best-effort, non-blocking).
- Idempotent: stamps `escalation_notified_at` once (already-stamped tiers are excluded by the query).
- Uses **match-based seeding** for the two `app_settings` reads (cron_secret vs slot defaults) and the per-tier `show_dates`/`bookings` reads.

### Task 2.3: `open-offer-tier`

**Contract (`app-logic.md` "The Offer → Booking Flow", "Eligibility"):**
- 404 if show date missing; 400 if cancelled.
- Tier 99: ad-hoc casts from `show_date_cast_eligibility` minus those already in `cast_city_priority` for the city; no city → all date casts.
- Tier 1–N: casts from `cast_city_priority` at that priority for the date's city; no city → `offers_created:0` with message.
- Union artists from `cast_members`; filter to `status='active'`; exclude artists with a non-cancelled booking for the date AND artists with a `blocked_dates` entry for the date.
- Insert one `suggested` booking per remaining candidate with `offer_tier`, `offered_at`, `is_understudy:false`, and **`offer_expires_at` intentionally NULL** (set later by the digest). Assert the insert payload shape.
- Upsert `show_date_offer_tiers (show_date_id, tier)` once.
- Needs match-based seeding (multiple `cast_city_priority`/`bookings`/`blocked_dates` reads).

### Task 2.4: `tier-at-risk-watcher`

**Contract:** for each open tier, at-risk when `pending('suggested') + accepted('soft_booked'|'confirmed') < requiredSlots`; insert one `tier_at_risk` notification per (tier,user), **idempotent** (don't duplicate existing); **delete** notifications for tiers that have recovered (without clobbering read-state of survivors); dedupe RPC producer results; admin fallback. Test the full lifecycle: at-risk → notified → recovered (deleted) → re-at-risk (re-created).

### Task 2.5: `send-confirmation-digest`

**Contract:** Berlin-hour gate on `confirmation_digest_hour_berlin` (default 20, DST-correct); group `confirmed` bookings by artist; one email each; stamp confirmation timestamp; skip no-email artists; stamp-failure handling (same at-least-once question as 2.1 — cross-reference the verdict).

---

# PHASE 3 — Email / webhook / sync deep tests

### Task 3.1: `send-transactional-email`

**Contract:** unknown template → 404; **suppression list is fail-closed** — if the recipient is in `suppressed_emails`, do NOT call Resend, return `{success:false, reason:'email_suppressed'}` (assert `deps.fetch` was NOT called); reads both key casings; renders template (registry); calls Resend via `deps.fetch` (seed `deps` with a `fetchImpl` returning a canned Resend 200/4xx and assert the request URL/headers/body); logs to `email_send_log` (non-blocking); unsubscribe-token upsert+read-back. **Highest-value test: prove fail-closed suppression** (a security/compliance property). Use `makeFakeDeps({ fetchImpl })`.

### Task 3.2: `handle-email-suppression`

**Contract:** non-POST → 405; invalid HMAC signature → 401 (now deterministic via injected `now` from Task 1.3 — **construct a VALID Standard-Webhooks signature in the test** using the same HMAC-SHA256 + base64 scheme and a known secret, and assert a `email.bounced`/`email.complained` event creates the right `suppressed_emails` row with reason `bounce`/`complaint`; assert non-suppression events are ignored with 200). Build the signed-request helper in the test file. This closes the security boundary the fake tests never covered.

### Task 3.3: `handle-email-unsubscribe`

**Contract:** token from query (GET) / form / JSON (POST); missing token → 400; unknown/expired token → 404; valid GET → `{valid:true}`; valid unused POST → marks `used_at=deps.now()` and `{success:true}`; already-used → `{success:false, reason:'already_unsubscribed'}`; atomic check-and-update via `.is('used_at', null)`. Test all three token-source formats.

### Task 3.4: `airtable-poll`

**Contract:** cron-secret auth; fetch Airtable pages via `deps.fetch` (seed `fetchImpl` to return canned Airtable JSON across `MAX_PAGES`); map fields → `show_dates` upsert (assert upsert payload + `onConflict` on airtable record id); for genuinely-new dates call `deps.invokeFunction('open-offer-tier', { show_date_id, tier: 1 })` (assert via `invokeCalls`); batch via `Promise.allSettled` — a single failing item must not abort the run (seed one invoke/upsert to reject and assert the others still process + the count reflects it). This is the densest task; if `deps.fetch` paging is hard to model, test the upsert/field-mapping with a single page first and note paging coverage in the bug log.

---

# PHASE 4 — Admin / notify / preview deep tests (lower risk)

Lighter coverage — happy + the one or two branches that carry logic. Per task: extend the smoke test into a small `index.di.test.ts` (or expand the smoke file) covering:

- **4.1 admin-decide-approval:** approved path calls `decide_user_approval` RPC with the right args (incl. `p_decided_by` = caller) + sends `signup-decision` email; rejected path; non-admin → 403; email failure is non-blocking (seed `invokeFunction` reject, assert still 200).
- **4.2 admin-set-role:** add inserts role; remove deletes; **prevent removing the last admin** (seed `user_roles` so only one admin remains → assert the guard blocks it); unique-violation on add is swallowed.
- **4.3 admin-list-users:** admin → assembles users with roles + approval status (seed `usersById` + `user_roles` + approvals); non-admin → 403.
- **4.4 notify-signup:** non-pending record → skipped; pending → notifies every admin (assert one `sendEmail` per admin); missing record → 400.
- **4.5 preview-transactional-email:** admin/producer → renders all templates (assert count == registry size) and reports per-template render status; a template that throws is reported as failed, not fatal; non-auth → 401.

Commit per function. Apply the bug-handling protocol throughout.

---

# PHASE 5 — Wrap

### Task 5.1: Full-suite gate
- [ ] `npm run lint` · `npm run build` · `export PATH="$HOME/.deno/bin:$PATH" && deno test --allow-all supabase/functions/` · `npx vitest run` — all green (ignored bug-tests excepted).
- [ ] Confirm no test was weakened to pass (grep for suspicious `assertEquals(true, true)`-style tautologies in new tests).
- [ ] Commit any final fixes.

### Task 5.2: Bug-log review + final code review
- [ ] Read `docs/superpowers/part1-bug-log.md`; ensure every CRITICAL/HIGH finding is either fixed (edge) or has a tracked DB-deferred item with an `ignore`d regression test.
- [ ] Dispatch a final code reviewer over `git diff <part1-start>..HEAD` focused on: are the new tests genuine contract assertions (not tautologies)?; are the bug fixes minimal + correct?; any behavior change beyond the documented fix?
- [ ] Summarize the bug crop for the human.

---

## Self-Review

**Spec coverage** (Part 0 spec §2 "Part 1 — Edge-function truth + bug crop", §5 methodology):
- "Deepen real DI-based tests across all functions" → Phases 2–4 cover all 14. ✓
- "regression-test-first; each fix lands with the test that catches it" → Bug-handling protocol §1. ✓
- "characterization test where behavior is intentional-but-undocumented" → protocol §2. ✓
- "DB-layer fixes go through migrations" → protocol §1 db-deferred path (no migration edits here; tracked in bug log). ✓
- Known suspect (send-offer-digest atomic update) → Task 2.1 explicitly. ✓
- Security boundaries (fail-closed suppression, HMAC) → Tasks 3.1, 3.2. ✓

**Placeholder scan:** Phase 1 has complete code; Phases 2–4 are intentionally contract+scenario specs (the test code is discovery-dependent — bugs aren't known in advance), with the protocol making each task's output well-defined. No "TBD".

**Consistency:** uses Part 0's `makeFakeDeps`/`createFakeClient`/`invokeCalls` names; the Task 1.1 `when`-seed form is referenced consistently by Phases 2–4.

**Scope note:** Part 1 is large (14 functions). If a single execution pass is too long, Phases 2 → 3 → 4 are natural stopping points (each is independently shippable on `dev`); the booking engine (Phase 2) is the highest-value and should land first.
