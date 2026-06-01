# Part 2 — Frontend Domain Logic — Bug & Characterization Log

Status legend: HIGH / MED / LOW severity; FIXED / CHARACTERIZED (documented current behavior, no change) / DEFERRED.

| Area | Severity | Status | Description |
|------|----------|--------|-------------|
| bookingStatusUpdate | LOW | CHARACTERIZED | `confirmed_at`/`cancelled_at` are only ever set, never cleared. Re-activating a cancelled booking (cancelled → soft_booked) or un-confirming (confirmed → soft_booked) leaves the stale timestamp in place. Documented by test; no change made pending product decision on whether reverse transitions should clear stamps. |
| fetchSlotDefaults / fetchProgramSubProgramPairs (`src/data/settings.ts`) | LOW | CHARACTERIZED | These two reads deliberately ignore the Supabase `error` field and fall back to `{}` / `[]` (preserved exactly from the original `useSettingsWarnings` hook). By contrast the sibling `useSubProgramSlots` throws on error. The settings-warnings UI therefore silently shows "no warnings" if either query errors. No change made — behavior-preserving extraction; flagged for a future error-handling convergence decision. |

## Summary

Part 2 surfaced **2 LOW characterization findings** (above) and **0 production bugs requiring a fix** — the existing pure logic and hook queries were correct; the gap was test coverage, not correctness. Both findings are documented current behavior, pinned by tests, and left unchanged pending product/design decisions. Net result: +45 frontend tests (95 → 140), all green; lint 0 errors; build clean.
