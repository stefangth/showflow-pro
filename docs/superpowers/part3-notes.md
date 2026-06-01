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
