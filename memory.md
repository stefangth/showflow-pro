# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-07-20

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly; PRs merge straight to `main` |
| `dev` | Exists on remote but stale/unused — recent PRs target `main` directly, not `dev` |
| `claude/adoring-knuth-yfkxze` | Current Claude Code session (docs sync) |

---

## In progress

_(nothing active)_

---

## Feature flag status

| Flag | Value | Notes |
|------|-------|-------|
| `AUTO_SUGGEST` | `true` | Scoring weights not yet in static config; logic lives in edge functions |
| `NOTIFICATIONS` | `true` | `notifications` table present in DB |
| `UNDERSTUDY` | `true` | Auto-promote on primary cancellation |
| `AUDIT_TRAIL` | `true` | `booking_audit_log` table — never delete rows |

Note: `AIRTABLE_SYNC` was removed from `FEATURES` in app.config.ts. Airtable sync is now fully implemented; it is enabled per-org via the `airtable_sync_enabled` key in `app_settings`.

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No seed-test-data edge function | Dev setup friction | Must bootstrap first org admin out-of-band (Supabase dashboard); org admin then invites others via Admin → Invites |
| `1.10.0` is untagged | Process gap | Tags caught up through `v1.9.0` (Jul 15) per the prior note, but `1.10.0` (hire orders + org modules, Jul 18) shipped without a `git tag`. Catch up when convenient. |

---

## Architectural decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| (initial) | Roles in `org_memberships` (per-org), never `profiles` | Multi-org support; enforced by `has_org_role()` / `is_org_member()` security-definer functions |
| (initial) | RLS is source of truth; client `hasRole()` is UX only | Prevents client-side bypass |
| (initial) | Week starts Monday app-wide | Consistency with show industry norms |
| (initial) | Chat locks after 30 days (`CHAT_ARCHIVE_DAYS`) | Prevents stale message threads; admins can still view |
| (initial) | Booking states: suggested → soft_booked → confirmed (or cancelled) | Mirrors industry booking workflow |
| (initial) | Supabase is external project, not Lovable Cloud | Separate lifecycle control |
| 2026-04-26 | AGENTS.md replaced by CLAUDE.md | Consolidated and expanded; added git workflow, env setup, testing, error handling, new-page checklist, feature flags, notification patterns |
| 2026-06-04 | Multi-tenancy: `app_settings` now per-org (org_id column) with platform-default fallback | Enables per-org configuration without duplicating the schema; `get_org_setting` / `resolveOrgSetting` encapsulate the two-row merge |
| 2026-06-04 | Super-admin model: `platform_admins` table + `is_super_admin()` + `PlatformRoute` | Separates god-mode (cross-org) from org-admin (single-org); super-admins bypass org gates without touching RLS |
| 2026-06-04 | Per-org Airtable API key in Supabase Vault | Keeps credentials out of app_settings (unencrypted JSONB) and enables true multi-tenancy for Airtable sync |
| 2026-06-04 | Data-access layer: all Supabase calls live in `src/data/<domain>.ts` as plain functions taking the client | Makes the data layer independently testable via the supabaseFake harness; hooks become thin wrappers |
| 2026-06-22 | Notification preferences are opt-out, gated server-side by a `gate_notification_pref` BEFORE INSERT trigger + `should_notify`/`category_of` RPCs | Users can mute non-critical categories without touching client code paths; critical notifications can't be muted |
| 2026-06-23 | Key architecture decisions moved out of `CLAUDE.md` into `docs/adr/README.md` ("Key decisions" operational summary + linked ADRs) | Single home for the *what/where* + *why*; `CLAUDE.md` stayed too long to keep accurate inline (ADR-0008 superseded) |
| 2026-06-23 | CI auto-deploys every edge function on merge to `main` (`.github/workflows/deploy-functions.yml`); Lovable build tooling retired | Removes the manual deploy step for the common case; new functions need a `[functions.<name>]` block in `supabase/config.toml` or they deploy JWT-locked |
| 2026-07-05 | Airtable poll cadence is per-org configurable (`airtable_poll_interval_minutes`, min 5) with an on-demand "Sync now" | Orgs with low-frequency Airtable changes don't need the default 5-min cron sweep; admins can force a sync between cycles |
| 2026-07-15 | Booking flow is configurable per org (`booking_flow` app_setting + `BookingFlow` policy in `src/lib/bookingFlow.ts`): presets (Classic/Fast-track/Direct book) or individual toggles (`artist_acceptance`, `producer_confirmation`, `auto_escalate`, `understudy_promotion`, `reference_field`) | Different orgs run fundamentally different booking styles (some skip offers entirely, some auto-confirm on accept) without forking the booking engine |
| 2026-07-16 | Cast eligibility ladders can be scoped per show (`show_cast_eligibility`), falling back to the org-wide `cast_city_priority` list | Some shows need a different tier order per city than the org default, without duplicating the whole priority config |
| 2026-07-17 | Per-org module entitlements (`src/lib/entitlements.ts` `FeatureKey`/`FEATURE_REGISTRY`, dual-homed to `_shared/entitlements.ts` and SQL `is_feature_enabled()`) gate `booking_flow` and `hire_orders`; toggled in the Platform console per org | Lets new feature modules ship dark and roll out org-by-org instead of a global flag flip |
| 2026-07-18 | Hire orders (`generate-hire-orders` edge function, `hire_orders` entitlement, ships dark) — draft/issue/preview/download-url PDF engagement sheets from confirmed bookings, with optional Documenso countersigning (`documenso-webhook`, off by default) | Replaces manual paperwork for engagement confirmations; countersigning is opt-in since not every org wants e-signature |
| 2026-07-18–19 | Zero-warning ESLint gate (`--max-warnings 0`) with `any` banned outside `src/data/**`/edge functions/test stubs; all pre-existing `any` casts replaced with explicit row types or the new typed test helpers (`src/test/castHelpers.ts`, `_shared/testing.ts`) | Prevents new type-safety regressions from accumulating silently; the typed helpers keep the one-cast-at-the-boundary rule enforceable in tests |
| 2026-07-19 | Auth readiness is derived (`sessionState.ts`'s `computeAuthReady(bootstrapped, userId, identityUserId)`) instead of toggled by an imperative `loading` flag; `src/config/env.ts`'s `missingClientEnv()` renders a config-error screen instead of a blank page when required env vars are missing | The imperative `loading` flag raced against async identity resolution and could flash a signed-in-but-org-less render (NoOrgScreen); deriving readiness from state makes that render impossible by construction rather than raced away |

---

## Environment

Required env vars (never commit to git):

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

Edge functions additionally use `SUPABASE_SERVICE_ROLE_KEY` (set in Supabase dashboard, not in `.env`).

---

## Recent changes

| Date | Change |
|------|--------|
| 2026-07-20 | Updated `CLAUDE.md` and `memory.md` — closed a two-week doc gap covering the 1.9.0 and 1.10.0 releases: added booking-flow configurability (presets/toggles) to the domain-rules section (replacing stale "Settings → Booking Engine" wording with the actual "Settings → Booking flow" tab name), documented entitlements-gated modules, expanded the `hireOrders/`/`settings/` component trees and `src/data/`/`src/hooks/` domain lists (`blockedDates`, `eligibility`, `settingsAudit`, `useBookingFlow`, `useEntitlements`, `useHireOrders`, `useSettingsAudit`), added the `documenso-webhook` and `email-health-watcher` edge functions, added `HireOrdersPage`/`HireOrderEditPage`/`FeatureDisabledScreen` to the pages list, documented the derived-auth-readiness rework (`sessionState.ts`) and `src/config/env.ts`'s config-error screen, and corrected the versioning section's tag range (tags now reach `v1.9.0`; `1.10.0` is the untagged gap). Current app version: `1.10.0` |
| 2026-07-19 | Auth loading-race fixes: `sessionState.ts` derived readiness (#179–181), config-error screen for missing env, resend key removed from tracked env file (#178) |
| 2026-07-18–19 | Zero-warning lint gate + full `any` sweep across frontend, edge functions, and test stubs (typed cast helpers added) |
| 2026-07-17–18 | Hire orders (v1.10.0, #169–175): draft/issue/preview/PDF engagement sheets, bulk import wizard, Hire orders page + split builder, Documenso countersigning, per-org module entitlements + Platform console toggles |
| 2026-07-15–16 | Booking flow editor + configurable eligibility (v1.9.0, #162–168): presets (Classic/Fast-track/Direct book), direct booking, fast-track, auto-escalation, show-scoped cast priorities, required skills, skill-aware understudy promotion, Settings change history |
| 2026-07-05 | Configurable Airtable poll interval + "Sync now" (#152, v1.8.0) — per-org `airtable_poll_interval_minutes`, super-admin platform default |
| 2026-07-05 | In-app automation system map — Settings → Documentation → System Map canvas (#149–151), mirrors `docs/system-map.md` via `src/data/systemMap.ts` |
| 2026-07-05 | Narrowed `expire_soft_bookings` + `should_notify` RPC grants to `service_role` (#150) |
| 2026-07-02 | Fable code review pass: security, booking-engine, and data-layer fixes (SFP-170–189) (#148) |
| 2026-07-01 | Artist account linking + bulk import (CSV/Excel/Google Sheets, `fetch-remote-sheet` + `bulk_import_artists` RPC) (#147, v1.7.0) |
| 2026-06-30 | Airtable sync: configurable view + Catalog-links redesign; `resolveOrgSetting` null-row passthrough fix (3 mirrors) (#145, #146) |
| 2026-06-27 | Sidebar restyle: sections, badges, wordmark, profile card (#141) |
| 2026-06-24–25 | ShowFlow Design System token spec applied across app, `/settings` + `/platform` (#139, #140); Productions configurable columns + Airtable linked-record sync (#137, v1.6.0) |
| 2026-06-24 | Platform System Health console Phase 1 (`SystemHealthTab`, `systemHealth/` panels) + cron-watcher false-timeout fix (#136) |
| 2026-06-23 | Retired Lovable build tooling; CI now auto-deploys edge functions on merge to `main` (#127, #130); key decisions moved to `docs/adr/README.md` (#134) |
| 2026-06-22 | Data & compliance (GDPR): `export-org-data`, `delete-my-account`, notification preferences (#125); in-app show & show-date management / catalog CRUD (#118) — retires the old "no UI to create show dates" known issue; admin & member self-service (#121) |
| 2026-06-21 | Centralized booking-engine defaults, purged hardcoded values (#114, #115); immersive hero-image login page (#112) |
| 2026-06-08 | Updated `CLAUDE.md` and `memory.md` — documented multi-tenancy phases 1–5 (per-org settings, super-admin model, platform console, `src/data/` layer, new hooks/pages/edge functions) |
| 2026-06-05 | Multi-tenancy Phase 5 (#94) — ProfilePage + ResetPasswordPage implemented, `useMyProfile`, MembersTab, `resend-invitation` edge function, invite unification |
| 2026-06-04 | Multi-tenancy Phase 4 (#92) — Platform console (`/platform` route, `PlatformPage`, `components/platform/`, `provision-org` edge function, super-admin model, `isSuperAdmin` in AuthContext) |
| 2026-06-04 | Multi-tenancy Phase 3 (#91) — all cron/booking-engine edge functions org-aware, per-org Airtable Vault key, `org_id` derivation triggers, `_shared/settings.ts` |
| 2026-06-04 | Multi-tenancy Phase 2 (#90) — `app_settings` per-org schema, `get_org_setting` DB function, `resolveOrgSetting` / `upsertOrgSetting` in frontend + edge, per-org editor config |
| 2026-05-30 | Updated `CLAUDE.md` and `memory.md` — documented GDPR consent system |
| 2026-05-28 | Added GDPR privacy policy, impressum, and cookie consent system (#65) |
| 2026-05-28 | Show inline error on failed login, hid Google sign-in button (#64) |
| 2026-05-28 | Fixed cast inheritance invalidation chain (#62) |
| 2026-04-26 | Created `CLAUDE.md`, `memory.md`; built `src/features/editor/`; restored `ArtistsPage` |
