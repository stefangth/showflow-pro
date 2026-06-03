# Part 2 — Frontend Domain Logic — Bug & Characterization Log

Status legend: HIGH / MED / LOW severity; FIXED / CHARACTERIZED (documented current behavior, no change) / DEFERRED.

| Area | Severity | Status | Description |
|------|----------|--------|-------------|
| bookingStatusUpdate | LOW | CHARACTERIZED | `confirmed_at`/`cancelled_at` are only ever set, never cleared. Re-activating a cancelled booking (cancelled → soft_booked) or un-confirming (confirmed → soft_booked) leaves the stale timestamp in place. Documented by test; no change made pending product decision on whether reverse transitions should clear stamps. |
| fetchSlotDefaults / fetchProgramSubProgramPairs (`src/data/settings.ts`) | LOW | FIXED | Previously these two reads ignored the Supabase `error` field and fell back to `{}` / `[]`, so a DB error was cached by React Query as success and the settings-warnings UI falsely showed "no warnings". The PR-70 review prompted reversing this characterization: both fetchers now `if (error) throw error;`, converging with `useSubProgramSlots`'s throw-on-error behavior. Regression tests assert each fetcher rejects on a seeded error. |

## Summary

Part 2 originally surfaced **2 LOW characterization findings** (above) and **0 production bugs requiring a fix** — the existing pure logic and hook queries were correct; the gap was test coverage, not correctness. The `fetchSlotDefaults / fetchProgramSubProgramPairs` row was later reclassified from CHARACTERIZED to FIXED after the PR-70 review (the silent error-swallowing was a real correctness bug for the settings-warnings signal). Net result: +45 frontend tests (95 → 140), all green; lint 0 errors; build clean.
