# Booking Flow: Follow-up Handoff

For a fresh Claude session picking up after PR #161 (configurable booking flow). Written 2026-07-14. Read this file top to bottom before doing anything; it is self-contained.

## Context in three sentences

PR #161 (branch `claude/booking-engine-ui-ux-09cbf4`) shipped the org-configurable booking flow: a `booking_flow` JSON policy in `app_settings` (org over platform over code default, defaults equal pre-existing behavior), engine compliance across all edge functions and DB triggers, a Settings → Booking flow editor (presets + timeline + live rail + change history), and the recomposed per-date cockpit. All six migrations from the branch are ALREADY APPLIED to production project `epweartpzwvcasrzyueh` with recorded versions matching the repo filenames. An external code review was fully addressed (both Highs, all Mediums fixed; three reasoned push-backs documented on the PR).

## Authoritative documents

- Spec: `docs/superpowers/specs/2026-07-14-booking-flow-editor-design.md`
- Implementation plan (executed, 24 tasks): `docs/superpowers/plans/2026-07-14-booking-flow-editor.md`
- PR: https://github.com/stefangth/showflow-pro/pull/161 (review threads carry fix commit refs)
- Session ledger (gitignored, exists only in the original worktree): `.superpowers/sdd/progress.md`
- Domain conventions: `CLAUDE.md` (root) and `docs/system-map.md` (updated by this branch; keep both homes in sync with `src/data/systemMap.ts` in the same PR for ANY automation change; `src/data/systemMap.test.ts` is the CI drift guard)

## State you can rely on

- Suites at branch head: vitest 702/702, Deno edge 650, tsc clean, lint 0 errors, build green. pgTAP and e2e run in CI.
- Production DB has: `settings_audit_log` (+trigger, RLS), transition guard allowing `suggested → confirmed`, `bookings.reminder_sent_at`, understudy-promotion policy gates, the flow-gated artist self-confirm RLS policy, `category_of()` mappings for `offer_expiring`/`tier_escalated`, and the review-hardening migration (`20260714182625`: auto-confirm notifications, throw-free boolean parsing, confirmed_at preservation, `trg_derive_org_id` fires on `UPDATE OF org_id`).
- Edge functions deploy automatically on merge to `main` (`.github/workflows/deploy-functions.yml`); no new function slugs were added, `supabase/config.toml` needed no changes.

## Status update (2026-07-15)

Tier 1 is COMPLETE: PR #161 merged (d1b1ded on main via release PR #162), version 1.9.0 released (changelog + JSON regenerated), semver tags caught up (v1.4.1 through v1.9.0 pushed). Tier 2 items 3, 4, 5, and 7 are COMPLETE on the tier-2 follow-up PR (direct-mode UI e2e; showIdentityLabel/referenceLabel convergence; page-level save hidden on the booking tab; polish batch incl. FlowTimeline badge reuse). Item 6 stays deferred pending producer feedback; the window-hours minimum remains an open product decision. Only Tier 3 (Phases 3 and 4) remains, each needing its own brainstorm/spec cycle.

## Remaining work, in priority order

### Tier 1: at/after merge of PR #161

1. **Merge bookkeeping.** If not already done by the main session: merge when CI is green (`gh pr merge 161 --merge`; never `--auto` in this repo). After merge, confirm the edge-function deploy workflow ran.
2. **Release tasks (repo convention, at release time not merge time):** bump `version` in `package.json` AND `APP_META.VERSION` in `src/config/app.config.ts`; add a `public/changelog.md` entry (end-user bullets: the flow editor, direct/fast-track modes, immediate delivery, reminders, auto-escalation, dry-run preview, change history); regenerate `public/changelog.json` via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Same-day changes fold into ONE version entry. Consider catching up semver git tags (tags stopped at v1.4.0).

### Tier 2: deferred review follow-ups (each small and independent)

3. **Direct-mode UI e2e.** `e2e/booking-flow-presets.spec.ts` test 3 inserts the confirmed booking via the admin client; drive it through the real `EligibilityBookList` UI instead (login as producer, open the date sheet, click Book). Helpers in `e2e/helpers/booking.ts` (`setBookingFlow` exists).
4. **Label convergence.** `showLabel` (`src/types/index.ts`, en-dash join) vs `referenceLabel` (`src/lib/bookingFlow.ts`, middot join): the sheet header, ArtistBookingsView, and both digests use `referenceLabel`; remaining surfaces (e.g. `DashboardPage`, `ShowsBookingsPage`) still use `showLabel`. Converge everything on `referenceLabel` and then delete or alias `showLabel`. Watch for sorting/filtering call sites that must NOT change.
5. **Dual save affordance on the Booking flow tab.** Both the page-level Save and the rail's scoped Save render; reconcile (likely: hide the page-level button on that tab). `src/pages/SettingsPage.tsx` + `src/components/settings/bookingFlow/`.
6. **Understudy checkbox UX.** Review push-back kept the list-wide "Book as understudy" toggle in `EligibilityBookList`; revisit only if producers report friction.
7. **Small polish batch** (one commit): stale top-of-file JSDoc in both digest edge functions (they do not mention the flow gates); `d_bookings.detail.Cite` in `src/data/systemMap.ts` missing `20260714104826`; error log on the reminder pass's in-app notification insert in `expire-offers`; `booking-times` query in `ShowDateDetailSheet` lacks an `enabled` guard; `FlowTimeline.tsx` re-derives the step-3 lifecycle badge logic instead of reusing the central helper in `bookingFlow.ts` (drift risk); consider a minimum guard on `offer_response_window_hours` (a 1h window makes the 24h expiry reminder fire immediately, a product decision).

### Tier 3: the original roadmap's later phases (each needs its own brainstorm/spec cycle)

8. **Phase 3: dashboards and artist surfaces fully flow-aware.** Producer dashboard beyond the Ready-to-Confirm gate (e.g. direct-mode framing, immediate-delivery hints), artist views and notification/email copy adapted per mode (offer language vs direct-booking language), artist response-rate meter semantics in direct mode.
9. **Phase 4: configurable eligibility.** The heavy one, deliberately parked: configurable tiering axis (today hardwired to city via `cast_city_priority`) and artist-attribute filters (skills tables exist but the engine ignores them). Needs data-model design; start from the spec's out-of-scope notes and `open-offer-tier`'s eligibility pipeline.

## Conventions and gotchas a fresh session must know

- **No em- or en-dashes in ANY user-facing copy** (UI strings, emails, docs, changelog). Use period/comma/colon/semicolon/middot; arrows fine. This is a standing user rule (also in persistent memory).
- **Dual-home modules:** `src/lib/bookingFlow.ts` and `supabase/functions/_shared/bookingFlow.ts` mirror types/defaults/normalize/referenceLabel; change both in the same PR. Same pattern as `BOOKING_ENGINE_DEFAULTS`.
- **The invariant** `artist_acceptance=false implies producer_confirmation=true` is enforced in `normalizeBookingFlow` on every read; never bypass it. The RLS policy and understudy trigger assume it.
- **Migrations:** new timestamped files only (`date -u +%Y%m%d%H%M%S`), never edit applied ones. Applying to prod via the Supabase MCP records apply-time versions; align them to the filename with an `UPDATE supabase_migrations.schema_migrations` afterwards (pattern used twice on this branch), and needs the user's explicit approval naming the prod project.
- **Tests:** `npx vitest run` (node_modules via `npm ci` in a fresh worktree), `deno test --allow-all --node-modules-dir=none supabase/functions/` (the flag is mandatory), `npx tsc -p tsconfig.app.json --noEmit` (NOT bare tsc), `npm run lint`. pgTAP is CI-only. Always run the WHOLE Deno suite after any edge change.
- **Query keys:** bookings mutations invalidate the `['bookings']` prefix; settings the `['app-settings']` prefix. Never enumerate sub-keys.
- **Booking flow resolution:** client `fetchBookingFlow`/`useBookingFlow` (src), edge `resolveBookingFlow(admin, orgId)`; both normalize. SQL reads use `get_org_setting(org_id, 'booking_flow')` with throw-free text comparison (`COALESCE(lower(v->>'key'),'true') <> 'false'` idiom, see `20260714182625`).
- Fresh worktrees have no `node_modules`; run `npm ci` first (~1 min).
