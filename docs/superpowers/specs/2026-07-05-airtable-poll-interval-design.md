# Configurable Airtable poll interval — design

*2026-07-05 · branch `claude/angry-merkle-8a5f9a`*

## Problem

`airtable-poll` runs on a single global pg_cron job (`*/5 * * * *`) that fans out
over every active org each run. There is a seeded `app_settings` row
`airtable_poll_interval_minutes` (platform default `5`, description "How often (in
minutes) to poll Airtable for changes") but **nothing reads it** — it is dead. The
only user-facing polling control today is the `airtable_sync_enabled` on/off toggle.
Admins have no way to slow polling down (e.g. an org whose Airtable base changes a
few times a day does not need a full-table scan every 5 minutes).

## Goal

Let each org's admin choose how often its Airtable base is polled, from a safe set of
presets, with a super-admin platform default and clear in-UI transparency about the
effective cadence — plus an on-demand "Sync now" for immediate pulls between cycles.

## Non-goals

- Rescheduling the pg_cron job per org (impossible: one global job for all orgs).
- Sub-5-minute polling (the master tick is the resolution floor).
- Free-text/arbitrary interval entry (presets only, to avoid rate-limit foot-guns).
- Per-table or per-view schedules; interval is per-org.

## Core mechanism — per-org throttle on a fixed tick

The master cron is **unchanged**: it still fires every 5 minutes and iterates active
orgs. The interval is enforced **inside the loop** as a gate, not by rescheduling:

```
for each active org:
  if not airtable_sync_enabled → skip (unchanged)
  interval  = resolveOrgSetting('airtable_poll_interval_minutes')   // org → platform default → 5
  lastAttempt = max(airtable_sync_log.synced_at) for this org, sync_type='airtable_poll'
  if lastAttempt and (now - lastAttempt) < clamp(interval)*60s - GRACE → skip this tick
  else → run the per-org sync (records a fresh sync_log row → advances lastAttempt)
```

- **Resolution floor:** the 5-min tick. An interval only takes effect on a tick
  boundary; effective cadence rounds up to the next tick.
- **Grace (`POLL_GRACE_SECONDS = 60`):** subtracted so a 5-min interval polls every
  tick instead of occasionally drifting to 10 min from a few seconds of cron jitter.
  60s ≪ 300s tick, so it never causes a double-poll.
- **Server clamp (`MIN_POLL_INTERVAL_MINUTES = 5`):** `effective = max(5, value)` so a
  hand-edited/legacy row can't set 0 (and nothing beats the tick anyway).
- **Broken orgs self-throttle:** misconfig runs also write a `sync_log` row, so a
  misconfigured org is retried at its interval instead of every 5 min.
- **Reuses the existing key** `airtable_poll_interval_minutes` (integer minutes). No new
  settings key and no new table — wiring it up is what activates the dead seed.
- Uses `deps.now()` for the comparison (deterministic in tests).

## Presets

Stored as integer minutes. UI is a dropdown backed by a pure, tested module
`src/lib/airtablePoll.ts`:

| Label     | Minutes |
|-----------|---------|
| 5 minutes | 5       |
| 15 minutes| 15      |
| 30 minutes| 30      |
| 1 hour    | 60      |
| 2 hours   | 120     |
| 4 hours   | 240     |
| 8 hours   | 480     |

`src/lib/airtablePoll.ts` exports: `POLL_INTERVAL_PRESETS` (`{value,label}[]`),
`MIN_POLL_INTERVAL_MINUTES = 5`, `POLL_GRACE_SECONDS = 60`, `clampInterval(min)`,
`formatInterval(min)`, and `nextSyncAt(lastSyncedAt, intervalMin) → Date`.

## The four best-in-class extras (all approved)

1. **Last synced / next sync line** — in `AirtableSyncTab`, derived from the
   already-fetched `fetchLatestSyncLog().synced_at` + the interval via `nextSyncAt()`:
   e.g. "Last synced 12 min ago · next sync ~in 3 min (on the next 5-min cycle)". When
   `synced_at` is null: "Not synced yet — will run on the next cycle."

2. **"Sync now" manual trigger** — a button that polls **only this org** immediately,
   bypassing the gate. Implemented as a **scoped branch in `airtable-poll`**:
   - Cron-secret request (`X-Cron-Secret`) → existing gated fan-out over all orgs.
   - Org-admin JWT + `{ org_id }` body (no cron secret) → `requireOrgRole(org_id,
     ['admin'])` then sync **that one org only**, `bypassGate = true`.
   - The dangerous cross-org fan-out stays cron-secret-only; the JWT path is scoped to
     the caller's own org, so an org admin can never drive cross-org writes.
   - `verify_jwt = false` on this function is retained (the cron caller needs it); the
     handler does its own `requireOrgRole`, which works regardless.
   - To keep both paths DRY, extract the per-org pipeline (resolve config → misconfig
     guards → `syncOrg`) into a local `syncOneOrg(deps, orgId, { bypassGate })` within
     `airtable-poll/index.ts`. The loop and the button path both call it.
   - Button is enabled only when sync is on and a key is present; shows pending state
     and toasts the result count. Frontend calls the function via
     `supabase.functions.invoke('airtable-poll', { body: { org_id } })`.
   - *Rejected alternative:* a separate `airtable-sync-now` function — cleaner auth
     separation but moves ~400 lines of `syncOrg` + helpers into `_shared`. The scoped
     branch is lower-risk and reuses the existing DI test file.

3. **Super-admin platform default** — a new "Airtable sync defaults" card in
   `PlatformDefaultsTab` writing the `org_id IS NULL` row for
   `airtable_poll_interval_minutes` (dropdown, same presets). Org admins override in
   their own tab. Mirrors the booking-engine-defaults tiering. New helpers in
   `data/platform.ts`: `fetchPlatformAirtableInterval` / `savePlatformAirtableInterval`.

4. **Rate-limit guidance** — concise inline note near the interval control: shorter
   interval = fresher data but more Airtable API calls (Airtable limits ~5 req/s per
   base) and more DB writes per cycle; longer interval = fewer calls, staler data.

## Files touched

**Edge**
- `supabase/functions/airtable-poll/index.ts` — extract `syncOneOrg(deps, orgId,
  {bypassGate})`; add the interval gate in the loop; add the org-admin-JWT scoped
  `sync_now` branch; add a small `fetchLastPollAt(admin, orgId)` read. Update the
  handler doc comment (JWT path is now scoped, not forbidden).

**Migration**
- New index `idx_airtable_sync_log_org_synced` on `airtable_sync_log (org_id,
  synced_at desc)` — supports the gate read and the existing `fetchLatestSyncLog`
  query. No key creation (the seed already exists).

**Frontend**
- `src/lib/airtablePoll.ts` — new pure module (presets, clamp, format, `nextSyncAt`).
- `src/data/airtableSettings.ts` — add `airtable_poll_interval_minutes` to
  `AirtableSettings`, `AIRTABLE_SETTING_KEYS`, `DEFAULTS`, and the fetch mapping.
- `src/components/settings/AirtableSyncTab.tsx` — interval `Select`, the last/next-sync
  line, "Sync now" button + mutation, rate-limit note. Reuse the existing
  `saveSettings.mutate({ airtable_poll_interval_minutes })` autosave path.
- `src/components/platform/PlatformDefaultsTab.tsx` — "Airtable sync defaults" card.
- `src/data/platform.ts` — platform interval fetch/save helpers.

**Docs / release (same PR — required by CLAUDE.md automation-change rule)**
- `docs/system-map.md` + `src/data/systemMap.ts` — airtable-poll node gains the
  interval-gate behavior; add the "Sync now" (admin-triggered) entry point.
- `CLAUDE.md` — one line noting per-org interval gating on the master tick.
- `public/changelog.md` (+ regenerated `public/changelog.json`), version bump in
  `package.json` and `APP_META.VERSION` — **MINOR** (new user-facing feature).

## Testing (test-first)

- `src/lib/airtablePoll.test.ts` — presets shape, `clampInterval` (below-min → 5),
  `formatInterval` (minutes vs hours labels), `nextSyncAt` (null → null/now, elapsed
  math).
- `supabase/functions/airtable-poll/index.di.test.ts` (extend existing suite):
  - first run for an org (no prior log) → polls;
  - within-interval (last poll recent) → skips, no sync_log write;
  - elapsed (last poll older than interval − grace) → polls;
  - clamp: interval value `1` behaves as `5`;
  - grace: interval 5, last poll 4m40s ago → still polls;
  - sync-now branch: org-admin JWT + org_id → syncs only that org, bypasses gate;
    non-admin → 403; org_id for a different org than the caller's role → 403;
    cron-secret path unchanged (still gated fan-out).
- `src/data/airtableSettings.test.ts` — fetch surfaces the interval (org override wins
  over platform default over `DEFAULTS`).
- `src/data/platform.test.ts` — platform interval fetch/save round-trip (if the file
  exists; else co-locate a new one).

## Risks & mitigations

- **Interval starves a fast-changing base** → admin choice; default stays 5 min, and
  "Sync now" covers urgent pulls.
- **Gate skips a legitimately-due org from cron jitter** → 60s grace absorbs it.
- **Scoped JWT branch widens `airtable-poll`'s auth surface** → branch is strictly
  single-org via `requireOrgRole(org_id,...)`; cron fan-out remains cron-secret-only;
  covered by new DI tests.
- **`syncOneOrg` extraction regresses the existing poll** → pure move of the
  config-resolution + guard block; existing DI suite must stay green.
