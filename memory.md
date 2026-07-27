# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-07-27

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly; PRs merge straight to `main` |
| `dev` | Exists on remote but stale/unused — recent PRs target `main` directly, not `dev` |
| `claude/adoring-knuth-bqbine` | Current Claude Code session (docs sync) |

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

This table only covers the original static flags. Everything added since (hire orders, per-org capability rights, booking-flow presets, ...) uses one of the two newer per-org mechanisms instead — see the entitlements/capabilities key decisions in `docs/adr/README.md`: **entitlements** (`src/lib/entitlements.ts`, `org_entitlements` table) gate whether a module exists at all (`hire_orders` ships with its entitlement off by default); **capabilities** (`src/lib/capabilities.ts`, `org_capabilities`/`org_capability_policies`) gate who may act once a module is on.

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No seed-test-data edge function | Dev setup friction | Must bootstrap first org admin out-of-band (Supabase dashboard); org admin then invites others via Admin → Invites |
| Releases since `v1.9.0` are untagged | Process gap | `package.json`/changelog are at `1.13.0` (Jul 25) but the last git tag is `v1.9.0` (Jul 15) — versions `1.9.1`–`1.13.0` shipped without a corresponding `git tag`. Catch up when convenient. |
| Dormant Documenso countersign path | Dead-code-shaped but intentional | `generate-hire-orders`'s `documenso` countersign mode + the `documenso-webhook` function are unreachable from the UI (Settings only offers manual\|electronic) — superseded by in-app electronic signing (#188) but deliberately retained for a possible future self-hosted Documenso. Don't "clean this up" without checking `docs/superpowers/specs/2026-07-23-hire-orders-in-app-signing-design.md` first. |

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
| 2026-07-15 | Booking flow is a configurable per-org policy (Classic / Fast-track / Direct-book presets or custom), resolved via `useBookingFlow`/`fetchBookingFlow`; `availability` table finally dropped for `blocked_dates` (ADR-0007 completed) | One booking-tier pipeline no longer fits every org; direct-book and fast-track skip stages of the classic offer flow. Required skills for shows/dates (`eligibility.ts`) plumb through offers, direct booking, and understudy promotion |
| 2026-07-18 | Hire orders module added, ships DARK (`hire_orders` entitlement defaults off) | `generate-hire-orders` engine (draft → issue → PDF → email), issued PDFs stored in the `hire-orders` bucket; optional Documenso countersigning at launch (superseded five days later, see below) |
| 2026-07-23 | In-app electronic signing replaces Documenso as the primary countersign path (#188) | The artist signs in-app (`sign` action, `SignHireOrderDialog`/`SignaturePad`) rather than through a third-party e-sign vendor; the `documenso` countersign mode and `documenso-webhook` function are retained but dormant/unreachable from the UI |
| 2026-07-23 | Per-org capability matrix ("user group rights") added: `src/lib/capabilities.ts` registry, layered resolution platform-lock → org-override → platform-default → registry-default (#192, v1.11.0) | Separates "does this module exist" (entitlements) from "who may use it" (capabilities); lets admins grant/withhold specific producer rights without an all-or-nothing producer role |
| 2026-07-23 | Platform super-admin user-management console added: cross-org user list + change-email/reset-password/suspend/delete, all appended to `platform_audit_log` (#186) | Super-admins previously had no first-party way to manage a user's auth account outside the Supabase dashboard |
| 2026-07-25 | Hire-order PDF template WYSIWYG editor over a semantic role registry (`src/lib/hireOrders/pdf/pdfTheme.ts`), plus per-date-vs-total fee basis (#197, #198, v1.13.0) | Orgs can restyle the issued PDF (wording, font, size, colour, spacing) without a code change; multi-date orders needed a fee model that distinguishes "per date" from "for the whole engagement" |

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
| 2026-07-25 | Hire-order PDF template WYSIWYG editor (outline / live preview / inspector over `pdfTheme.ts`) + per-date-vs-total fee basis with a cents-safe multiplier and PDF breakdown line (#197, #198, v1.13.0) |
| 2026-07-24 | Named/rename-able terms templates, per-date session times, booking-agent signature upload, hire-order CTAs surfaced on Shows & Bookings + the show-date sheet, wizard duration-copy and date pre-selection (#193 + follow-on commits, v1.12.0) |
| 2026-07-23 | Hire-order batching/delivery/signing overhaul; **in-app electronic signing added and Documenso countersigning superseded** (ships dark) (#188, #191); per-org capability matrix ("user group rights") + `producer_can_invite` flag (#187, #192, v1.11.0); platform super-admin user-management console (#186); system-health degraded-state explanations + email-health webhook delivery-tracking fix (#189, #190) |
| 2026-07-18–22 | Hire orders module launched, ships dark (v1.10.0, #183); Settings moved to a grouped side-nav (v1.10.3); multi-tab auth-lock endless-spinner fix (v1.10.2); locked (not hidden) sidebar modules + auto-open-tier-on-new-date-fix (v1.10.1); system-health 4xx blindness / entitlement UX / `open-offer-tier` 401 fixes (#183); exposed Resend key rotated out of the repo (#178) |
| 2026-07-15 | Booking-flow editor: Classic/Fast-track/Direct-book presets, auto-escalation, dry-run preview, required skills + skill-scoped offers/understudy promotion, settings change-history; `availability` table finally dropped for `blocked_dates` (ADR-0007 completed) (v1.9.0) |
| 2026-07-27 | Updated `CLAUDE.md` and `memory.md` — three weeks of fast hire-order/permissions work (v1.9.0→v1.13.0, #178–#198) had outrun the docs: `src/data/` was missing 5 domains (`blockedDates`, `capabilities`, `eligibility`, `platformUsers`, `settingsAudit`), `src/hooks/` was missing 7 hooks, `components/platform/` and `components/settings/` trees were missing whole subdirectories (`UsersTab`/`UserDetailSheet`, `permissions/`, `bookingFlow/`, `EmailTemplatesCard`), `components/hireOrders/` still described the old single-viewer shape instead of the current list/wizard/edit/sign surfaces, `pages/` was missing `HireOrdersPage`/`HireOrderEditPage`/`FeatureDisabledScreen`, the hire-orders edge-function bullet said "four actions" when the function now has eleven (and didn't mention in-app signing or the dormant Documenso path at all), the Platform/Watchers edge-function bullets were missing `platform-list-users`/`platform-manage-user`/`email-health-watcher`, and the versioning section's tag-gap line was three minor versions stale. Current app version: `1.13.0` |
| 2026-07-06 | Updated `CLAUDE.md` and `memory.md` — closed a month-long doc gap (two prior sync attempts, #116 and #142, were closed unmerged): fixed `src/data/` domain list, `src/hooks/` list, `components/platform/` and `components/settings/` trees, the `close-offer-tier`/`open-offer-tier` "cron function" ambiguity flagged in #142's review, `src/data/account.ts` key-files row, and the versioning section's stale tag range. Current app version: `1.8.0` |
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
