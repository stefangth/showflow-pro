# ADR-0002: Testability foundation — edge-function DI, data-access extraction, five test layers

**Status:** Accepted
**Date:** 2026-06-01 *(recorded retroactively 2026-06-16 from the design spec; this decision predates the ADR convention)*
**Deciders:** Stefan Schaal (platform owner)

## Context

The edge-function test suite was structurally fake. Per the design spec: *"All 7
`supabase/functions/*/index.test.ts` files import only `assertEquals`/`assertExists` … **None
import from their `index.ts`.** The functions export no helpers, so each test re-implements a
*copy* of the logic and tests the copy. Some assertions are tautologies … The real handlers and
their Supabase I/O are untested while CI reports green — false confidence."* The DB layer (pgTAP)
was strong; frontend tests were "real but patchy and high-friction" with no shared harness. An
existing extracted pure function (`effectiveSlots()`) was the proven pattern to generalize.

## Decision

Three settled choices (spec §3):
1. **Backend: full dependency injection across all edge functions.** Every handler runs as
   `handle(req, deps)` with the Supabase clients, `env`, clock (`now`), `sendEmail`, and `fetch`
   injected; only `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()))` wires the
   real world. `Deps` lives in `_shared/deps.ts`; shared `_shared/http.ts` (CORS + `json`) and
   `_shared/auth.ts` (`requireRole`).
2. **Frontend: fake-client + data-access extraction.** Reads/writes move into `fetchX(client, args)`
   / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks become thin wrappers; tests drive a
   **call-recording** fake client (`src/test/supabaseFake.ts`) plus `renderWithProviders` +
   `fixtures`.
3. **Five test layers** — Vitest unit/hook + component (jsdom), pgTAP DB, Deno edge, Playwright
   e2e — and one hard rule: **tests import the real module; never re-implement production logic in
   a test.**

## Options Considered

### Rollout: validate-first *(CHOSEN)* vs. blind mechanical sweep
- **Validate-first:** convert two pilot functions (`open-offer-tier`, `expire-offers`) with *real*
  tests because *"Between them these two hit **every facet of `Deps`**"*, then mechanically roll out
  the remaining ~13 with thin smoke tests; flag anything tangled for a later part rather than
  silently rewriting it.
- **Blind sweep (rejected):** *"A blind mechanical conversion of ~15 functions with no new tests is
  the riskiest possible first move for a TDD initiative."*

**Alternative test architectures** (integration-only, global `createClient` mock, etc.): **not
documented** — DI + data-access extraction was presented as the settled choice, building on the
`effectiveSlots()` precedent.

## Trade-off Analysis

The cost of validate-first is touching `Deps` twice (pilot, then rollout); the benefit is learning
the injection seam on 2 functions instead of 15. Smoke tests on the rolled-out functions are
shallow by design, accepted for Part 0 and deepened later.

## Consequences

- **Easier:** edge handlers and their Supabase I/O become unit-testable with no live stack; the DI
  seam is reused by every later initiative (multi-tenancy edge tests; Phase-5 `deliverOrgInvitation`
  tests inject a fake `generateLink`).
- **Harder / accepted:** a "behavior-preserving" refactor can silently change behavior (mitigated by
  mechanical diffs + e2e/pgTAP); the `Deps` shape may need revision after the pilot ("that is the
  point"); smoke tests give limited safety on the rolled-out functions (accepted, deepened later).
- **Naming drift to note:** the design draft used `fakeDeps`/`_shared/testing/fakeDeps.ts`; as
  shipped it is `makeFakeDeps` in `_shared/testing.ts` (per CLAUDE.md).

## Implementation (delivered)

- Spec: `docs/superpowers/specs/2026-06-01-testability-foundation-part0-design.md` (§§1–10).
- Codified in CLAUDE.md "Testing" section (the five layers, both DI patterns, the import-the-real-
  module rule). Part-0 PR merge dates are not in the captured PR window; the spec date (2026-06-01)
  is firm.
