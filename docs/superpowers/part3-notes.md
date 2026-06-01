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
- [ ] e2e: eligibility-gating.spec.ts
- [ ] e2e: chat-access-control.spec.ts
- [ ] coverage gate green in CI

## Findings / bugs
- (none yet)
