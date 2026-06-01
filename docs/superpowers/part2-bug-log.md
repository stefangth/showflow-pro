# Part 2 — Frontend Domain Logic — Bug & Characterization Log

Status legend: HIGH / MED / LOW severity; FIXED / CHARACTERIZED (documented current behavior, no change) / DEFERRED.

| Area | Severity | Status | Description |
|------|----------|--------|-------------|
| bookingStatusUpdate | LOW | CHARACTERIZED | `confirmed_at`/`cancelled_at` are only ever set, never cleared. Re-activating a cancelled booking (cancelled → soft_booked) or un-confirming (confirmed → soft_booked) leaves the stale timestamp in place. Documented by test; no change made pending product decision on whether reverse transitions should clear stamps. |
