# Testability Foundation (Part 0) — Design

**Date:** 2026-06-01
**Branch:** `dev`
**Status:** Approved design — pending spec review before implementation planning

---

## 1. Context & problem

The working impression was "the codebase is buggy and lacking tests." Analysis showed the truth is more specific, and that specificity drives this design:

- **Test *infrastructure* is mature, not absent.** A 5-layer CI pipeline (`.github/workflows/ci.yml`) runs on every PR: lint → Vitest unit → pgTAP database tests → Deno edge-function tests → Playwright e2e (PRs to `main` only).
- **The edge-function tests are structurally fake.** All 7 `supabase/functions/*/index.test.ts` files import only `assertEquals`/`assertExists` from `_shared/test-asserts.ts`. **None import from their `index.ts`.** The functions export no helpers, so each test re-implements a *copy* of the logic and tests the copy. Some assertions are tautologies (`assertEquals("OPTIONS", "OPTIONS")`). The real handlers and their Supabase I/O are untested while CI reports green — false confidence, and the most likely source of the "buggy" feeling.
- **The database layer is the strongest part.** Core trigger and RLS logic (status computation, understudy promotion, auto-cancel, audit/notify, RLS on bookings/chats/notifications) has substantial pgTAP coverage (`supabase/tests/`, ~1,750 lines, real fixtures with rollback).
- **Frontend tests are real but patchy and high-friction.** Timezone-critical utilities (`src/lib/dates.ts`), filter/sort utils, and avatar logic are untested. Booking-status transitions and timestamp logic are buried inline in large components (`ShowDateDetailSheet.tsx` 496 lines, `CastDetailsSheet` 342 lines) and are untested. Every hook test re-implements QueryClient setup + ad-hoc Supabase mocking — there is **no shared test harness**.
- **A gold-standard pattern already exists:** `effectiveSlots()` extracted as a pure function from `useSubProgramSlots` and fully unit-tested. The goal is to make that shape the default everywhere.
- **CLAUDE.md does not forbid TDD, but is under-specified.** Its Testing section prescribes the ad-hoc `vi.mock` pattern, is silent on test-first as a norm, describes only the Vitest layer, and never states the rule whose absence allowed the fake tests: *tests must import the real module — never re-implement production logic in the test.*

---

## 2. Overall goal & the 4-part roadmap

**Goal of the larger effort:** maximize meaningful test coverage across all layers, fix the fake tests, and actively surface and fix the bugs the missing tests were hiding — with TDD as the default going forward.

Too large for one spec, so it is decomposed into sequenced sub-projects, each with its own spec → plan → implement cycle:

| Part | Title | Scope |
|---|---|---|
| **0** | **Testability foundation** *(this spec)* | Shared harness for both layers; full backend dependency-injection conversion (validate-first); CLAUDE.md rewrite. |
| 1 | Edge-function truth + bug crop | Deepen real DI-based tests across all functions; fix the bugs surfaced. |
| 2 | Frontend domain logic | Data-access extraction across hooks/components; backfill tests; fix bugs. |
| 3 | DB + integration hardening | pgTAP gap-fill; e2e expansion; CI coverage gate. |

**Confirmed sequence:** 0 → backend (1) → frontend (2) → DB (3).

**Methodology woven through 1–3:** write tests that assert *correct* behavior per `docs/app-logic.md`; failing tests become the bug list, and each fix lands with the test that catches it (regression-test-first). Where behavior is intentional-but-undocumented, lock it with a characterization test. DB-layer fixes go through migrations.

---

## 3. Architecture decisions (settled)

1. **Backend test architecture: full dependency injection across all edge functions.** Every handler runs as `handle(req, deps)` with the Supabase client, env, clock, email sender, and `fetch` injected; tests pass a fake client and assert real query/mutation/clock/email paths.
2. **Frontend test architecture: fake-client + data-access extraction.** Data fetching moves into `fetchX(supabase, args)` functions; hooks become thin wrappers; tests drive those functions with a reusable **call-recording** fake client, so they can assert the right table/columns/filters were queried — not just the canned return.
3. **Part 0 delivers the full backend DI conversion**, using a **validate-first rollout** (Section 5) rather than a blind mechanical sweep.

---

## 4. Part 0 deliverables

### A. Backend — dependency-injection seam

New shared modules under `supabase/functions/_shared/` (all greenfield — there is currently no shared CORS or client factory; every function inlines `createClient(...)`, reads `Deno.env.get(...)`, and copy-pastes CORS + auth):

- **`cors.ts`** — the shared `corsHeaders` and `json(body, status)` helper (currently duplicated in every function).
- **`deps.ts`** — the injection seam:
  ```ts
  export interface Deps {
    admin: SupabaseClient;                          // service-role client
    userClient: (authHeader: string) => SupabaseClient;
    env: (key: string) => string | undefined;
    now: () => Date;                                // Berlin-time gates & expiry
    sendEmail: (msg: EmailMessage) => Promise<EmailResult>; // wraps Resend
    fetch: typeof fetch;                            // Airtable & other outbound HTTP
  }
  export function realDeps(): Deps { /* built from Deno.env + createClient + real Resend/fetch */ }
  ```
- **`auth.ts`** — `requireRole(deps, req, roles)` extracting the duplicated JWT/service-role check + `auth.getClaims` + `user_roles` lookup.

Every function is converted to:
```ts
export async function handle(req: Request, deps: Deps): Promise<Response> { /* ...logic... */ }
if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

A **Deno-side fake-client + fake-deps helper** (e.g. `_shared/testing/fakeDeps.ts`) provides a chainable, call-recording Supabase double and a `fakeDeps(overrides)` builder, so tests `import { handle }` and inject fakes.

### B. Frontend — test harness

Production refactor of hooks is **Part 2**, but Part 0 builds and *proves* the tooling:

- **`src/test/queryClient.ts`** — `createTestQueryClient()` (retry off).
- **`src/test/renderWithProviders.tsx`** — wraps `QueryClientProvider` (+ Router / Auth as needed).
- **`src/test/supabaseFake.ts`** — `createFakeSupabase(seed)`: chainable, **records calls** for assertion.
- **`src/test/fixtures.ts`** — typed builders (`anArtist()`, `aShow()`, `aShowDate()`, `aBooking()`, `anAvailability()`, `aCast()`, `aNotification()`, `aProfile()`, `aUserRole()`) derived from `Database` types, with overrides.
- **One reference hook** converted to the `fetchX(supabase, args)` data-access pattern + its real test, as the copy-paste template for Part 2. Suggested candidate: a currently-untested, single-query hook such as `useMyArtist` (simple enough to be a clean template, real enough to exercise the call-recording fake); final choice at planning stage.

### C. CLAUDE.md — testing conventions rewrite

- Mandate **test-first** for new logic.
- Document all five layers (Vitest unit, pgTAP DB, Deno function, Playwright e2e) and when each applies — currently only Vitest is described.
- Document the **two DI patterns** (backend `handle(req, deps)` + `realDeps()`; frontend data-access extraction + fake client + fixtures).
- State the hard rule: **tests import the real module — never re-implement production logic inside a test file.**
- Replace the ad-hoc `vi.mock` guidance with the shared harness.
- Extend "Things to avoid": re-implementing logic in tests; constructing a Supabase client inline in an edge function instead of via `realDeps()`.

---

## 5. Validate-first rollout (the core of Part 0)

A blind mechanical conversion of ~15 functions with no new tests is the riskiest possible first move for a TDD initiative — it refactors the codebase with almost no behavioral net (existing e2e touches ~4–5 functions happy-path only; pgTAP covers triggers, not function glue), and it cannot reveal whether the `Deps` interface is actually ergonomic until a test is written against it. So the rollout is staged:

**Stage 1 — Prove the seam (2 pilot functions, with real tests):**
- **`open-offer-tier`** — exercises the user-JWT auth path (`requireRole`/`userClient`), eligibility resolution, and booking `insert`/`upsert`.
- **`expire-offers`** — exercises the clock (`now`), the `expire_soft_bookings` RPC, escalation decisioning + idempotency, notification inserts, and `sendEmail`.

Between them these two hit **every facet of `Deps`** (cron + user auth, admin client, clock, email, select/insert/upsert, RPC). Their tests are written against the real `handle` + fake deps and assert the real query/mutation paths. If `Deps` is awkward, we learn it here — at a cost of 2 functions, not 15.

**Stage 2 — Roll out (remaining ~13 functions, mechanical):**
- Convert each to `handle(req, deps)` + `realDeps()`, deduping CORS/auth via the shared modules. **Behavior-preserving — no logic changes.**
- Each lands with a **thin smoke test** (happy path + auth-fail → expected status) so no function is refactored at zero coverage.
- `send-offer-digest` is the priority target in this wave; its non-atomic `digest_sent_at` + `offer_expires_at` update is a known bug suspect and gets a real (not just smoke) test.
- Any function too tangled to convert mechanically is **flagged for Part 1**, not silently rewritten.

This still delivers **full backend DI in Part 0** (the chosen scope); it simply refuses to refactor blind. Part 1 then becomes "deepen coverage + fix the remaining bugs," not "write every test from scratch."

---

## 6. Safety net for the refactor

- DI conversion is **strictly mechanical / behavior-preserving**.
- Gated by `npm run build` (tsc), `npm run lint`, `deno check`, and the **existing pgTAP + Playwright e2e** suites (which already exercise real functions: signup→approval, booking lifecycle, the triggers).
- The Stage-1 pilot tests + Stage-2 smoke tests provide per-function coverage during the sweep.
- Existing fake Deno tests are **left in place** in Part 0 (they pass harmlessly); Part 1 replaces them with real ones.

---

## 7. PR plan (on `dev`)

- **PR A — Harness + conventions.** Frontend `src/test/*` utilities + fixtures + one reference hook; `_shared/{cors,deps,auth}.ts` + Deno fake-deps helper; CLAUDE.md rewrite. No backend behavior change. Small, easy review.
- **PR B — Pilot DI.** Convert `open-offer-tier` + `expire-offers` to DI **with real tests**. Proves the seam.
- **PR C — DI rollout.** Mechanical DI conversion of the remaining ~13 functions, each with a smoke test (+ real test for `send-offer-digest`). May split by function group if the diff gets heavy.

Exact PR boundaries are a planning-stage detail; this is the intended shape.

---

## 8. Definition of done

- `src/test/` harness (fake client, QueryClient wrapper, fixtures) exists and is exercised by at least the one reference hook test.
- `_shared/{cors,deps,auth}.ts` + Deno fake-deps helper exist.
- **Every** edge function runs as `handle(req, deps)`; `Deno.serve` only wires `realDeps()`.
- `open-offer-tier` and `expire-offers` have real DI-based tests asserting their query/mutation/clock/email paths; every other function has at least a smoke test; `send-offer-digest` has a real test of its stamp/expiry update.
- CLAUDE.md mandates test-first and documents all five layers + both DI patterns + the "import the real module" rule.
- `npm run build`, `npm run lint`, `deno check`, pgTAP, and Playwright e2e all pass.

---

## 9. Risks

- **A "behavior-preserving" refactor silently changes behavior.** Mitigation: keep diffs mechanical; lean on e2e/pgTAP + pilot/smoke tests; flag (don't rewrite) anything that resists mechanical conversion.
- **The pilot reveals the `Deps` shape is wrong after PR A ships.** Acceptable — that is the point of validating on 2 functions first; `deps.ts` is cheap to revise before the rollout.
- **Smoke tests give a false sense of safety on the ~13 rolled-out functions.** Accepted for Part 0; Part 1 deepens them. The smoke test's only job here is "the handler still wires up and gates auth."

---

## 10. Out of scope (handled in later parts)

- Real, deep tests for all edge functions + backend bug fixes → **Part 1**.
- Data-access extraction across all hooks/components; pure-util tests (`dates.ts`, filters, avatar); extracting booking-status logic from large components → **Part 2**.
- pgTAP gap-fill, e2e expansion, CI coverage gate → **Part 3**.
