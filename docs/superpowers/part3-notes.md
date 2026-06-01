# Part 3 — DB + Integration Hardening — Notes

## types.ts regeneration (Phase A)
Regenerated via Supabase MCP `generate_typescript_types` (project `epweartpzwvcasrzyueh`). Diff: +146/−11 lines.
- **Tables newly typed** (were absent → forced `as any` in app code): `blocked_dates`, `cast_city_priority`, `show_assignments`, `show_date_offer_tiers`, `show_date_cast_eligibility`, `show_cast_eligibility`.
- **bookings columns added**: `offered_at`, `offer_tier`, `offer_expires_at`, `digest_sent_at`, `confirmation_digest_sent_at` (the offer-engine columns the edge functions write).
- **Function signatures added**: `expire_soft_bookings`, `resolve_show_assignments` (Args/Returns), `get_column_descriptions`, `compute_show_date_status`, `is_chat_participant`, `has_role`, `decide_user_approval`.
- **App impact**: build clean, 140 Vitest pass, 0 lint errors — no type breakage from the richer types (regen is purely additive/corrective). No table/column the app uses was removed.

## CI-validation checklist (Phases B–D, verified via the Phase E PR)
- [x] pgTAP: availability_blocked_dates.sql (authored; pending CI run)
- [x] pgTAP: offer_engine_tables.sql (authored; pending CI run)
- [x] pgTAP: reference_tables.sql (authored; pending CI run)
- [x] pgTAP: expire_soft_bookings.sql (authored; pending CI run)
- [x] pgTAP: resolve_show_assignments.sql (authored; pending CI run)
- [x] pgTAP: recompute_and_timestamps.sql (authored; pending CI run)
- [x] e2e: eligibility-gating.spec.ts (authored; pending CI run)
- [x] e2e: chat-access-control.spec.ts (authored; pending CI run)
- [~] coverage gate: config done (vitest.config.ts coverage block + thresholds + `coverage/` gitignored). ACTIVATION PENDING — see below.

### Coverage gate — activation step (requires an npm environment)
Task 11 (config) is committed and inert (CI still runs `npm test`, not `--coverage`). To activate the gate, in an environment with `npm` (this dev machine has only Deno — no npm/node, so the lockfile can't be synced here):
1. `npm install -D @vitest/coverage-v8@^3.2.4` (updates `package.json` AND `package-lock.json` — both must land together or `npm ci` breaks every CI job).
2. In `.github/workflows/ci.yml`, change the unit-tests job step from `npm test` to `npm run test:coverage` (script already exists = `vitest run --coverage`); the thresholds in vitest.config make it fail-on-regression.
3. Commit `package.json` + `package-lock.json` + `ci.yml` together. If the starting thresholds (statements 25 / branches 60 / functions 40 / lines 25) are above the measured numbers, lower them to just under actual — never disable the gate.

## Findings / bugs
- (none yet)
