# Cron RPC timeout hardening (expire-offers)

**Problem.** Since 2026-09-09 `expire-offers-hourly` fails about 2 of 24 runs a day.
Supabase's API gateway cuts off roughly 0.5% of REST calls after exactly 5 s (504),
even though the SQL runs in under 150 ms. The 5 s limit is on Supabase's side; we
cannot raise it. When the 504 lands on:

- `get_cron_secret` (auth): `requireCronSecret` ignores the RPC error, compares against
  an empty string, and reports `401 Unauthorized`. The failure is mislabelled.
- `expire_soft_bookings`: the job returns `500 Gateway Timeout`.
- the `organizations` read: the job logs, treats zero orgs as entitled, and silently
  skips the expiry step while still returning 200.

**Fixes.**

1. `_shared/retry.ts`: `retryOnError(call, delayMs)` runs a supabase-style call
   (`{ data, error }`) and, on `error`, waits briefly and runs it once more. The 504s
   are isolated single calls, so one retry covers them.
2. `requireCronSecret`: reject a missing header before any lookup (401); look the
   secret up via `retryOnError`; if the lookup still fails, return
   `503 { error: "Cron secret lookup failed" }` instead of a false 401. Every cron
   function using `requireCronSecret` / `requireCronOrRole` gets this.
3. `expire-offers`: wrap `expire_soft_bookings` (idempotent) in `retryOnError`, and
   retry the active-org read once before giving up.
4. `expire-offers`: filter the escalation scan's open-tier query to show dates that are
   today or later (Berlin), via an inner embed on `show_dates`, so it stops re-reading
   past-dated tiers every hour (17 in prod today). The in-loop `isFutureOrToday` guard
   stays as defense in depth.

**Tests first.** `retry.test.ts`; `auth.test.ts` (retry passes, 503 on double failure,
401 on missing header without a lookup); `expire-offers/index.di.test.ts` (expiry RPC
retried, org read retried, open-tier query carries the date filter).

**Docs.** `docs/system-map.md` dispatch-plumbing note + `src/data/systemMap.ts` mirror.
No changelog (no user-facing change). No help center impact.
