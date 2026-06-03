# Part 3 — DB + Integration Hardening — Notes

## types.ts regeneration (Phase A)
Regenerated via Supabase MCP `generate_typescript_types` (project `epweartpzwvcasrzyueh`). Diff: +146/−11 lines.
- **Tables newly typed** (were absent → forced `as any` in app code): `blocked_dates`, `cast_city_priority`, `show_assignments`, `show_date_offer_tiers`, `show_date_cast_eligibility`, `show_cast_eligibility`.
- **bookings columns added**: `offered_at`, `offer_tier`, `offer_expires_at`, `digest_sent_at`, `confirmation_digest_sent_at` (the offer-engine columns the edge functions write).
- **Function signatures added**: `expire_soft_bookings`, `resolve_show_assignments` (Args/Returns), `get_column_descriptions`, `compute_show_date_status`, `is_chat_participant`, `has_role`, `decide_user_approval`.
- **App impact**: build clean, 140 Vitest pass, 0 lint errors — no type breakage from the richer types (regen is purely additive/corrective). No table/column the app uses was removed.

## CI-validation checklist (Phases B–D — validated via PR #70, full matrix GREEN on re-run)
- [x] pgTAP: availability_blocked_dates.sql (CI green)
- [x] pgTAP: offer_engine_tables.sql (CI green)
- [x] pgTAP: reference_tables.sql (CI green)
- [x] pgTAP: expire_soft_bookings.sql (CI green)
- [x] pgTAP: resolve_show_assignments.sql (CI green)
- [x] pgTAP: recompute_and_timestamps.sql (CI green)
- [x] e2e: eligibility-gating.spec.ts (CI green)
- [x] e2e: chat-access-control.spec.ts (CI green)
- [~] coverage gate: config done (vitest.config.ts coverage block + thresholds + `coverage/` gitignored). ACTIVATION PENDING — see below.

### Coverage gate — activation step (requires an npm environment)
Task 11 (config) is committed and inert (CI still runs `npm test`, not `--coverage`). To activate the gate, in an environment with `npm` (this dev machine has only Deno — no npm/node, so the lockfile can't be synced here):
1. `npm install -D @vitest/coverage-v8@^3.2.4` (updates `package.json` AND `package-lock.json` — both must land together or `npm ci` breaks every CI job).
2. In `.github/workflows/ci.yml`, change the unit-tests job step from `npm test` to `npm run test:coverage` (script already exists = `vitest run --coverage`); the thresholds in vitest.config make it fail-on-regression.
3. Commit `package.json` + `package-lock.json` + `ci.yml` together. If the starting thresholds (statements 25 / branches 60 / functions 40 / lines 25) are above the measured numbers, lower them to just under actual — never disable the gate.

## Findings / bugs

### CI matrix first-run results (PR #70)
First time the full CI matrix ran on a PR to main. Lint + Unit (Vitest) passed → Phase A (types regen, cast removal, coverage config) fully CI-validated. Failures + fixes:

**Pre-existing bugs surfaced (not caused by Part 3):**
1. **Deno function-tests CI job never resolved npm deps.** `_shared/deps.ts` imports `npm:@supabase/supabase-js@2`, but the root `package.json` forces Deno into node_modules mode and the job never populated `node_modules` → "Could not find @supabase/supabase-js in a node_modules folder". FIXED: added `--node-modules-dir=none` to the `deno test` command so Deno uses its global npm cache. (Locally confirmed the flag resolves the import.)
2. **`booking-lifecycle.spec.ts` strict-mode double-match.** `getByText(/offer accepted/i)` matched both the sonner toast div and its aria-live announcement. FIXED: `.first()`.

**Part 3 test fixes:**
3. pgTAP `resolve_show_assignments.sql` + `recompute_and_timestamps.sql`: invalid UUID literals (non-hex mnemonic segments `sa00`/`rc00`) killed the fixtures → "planned N ran 0". FIXED: hex-only UUIDs (`sa00`→`5a00`, `rc00`→`bc00`).
4. pgTAP `offer_engine_tables.sql`: producer-INSERT assertion collided with a pre-seeded `(cast,city)` pair (unique constraint). FIXED: added a fresh city fixture and inserted a non-colliding pair.
5. e2e `chat-access-control.spec.ts`: send button is icon-only (no accessible name) → `name:/send/i` click timed out. FIXED: submit the form via `input.press("Enter")`.

eligibility-gating e2e passed on the first run.
