# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-08-10

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly; PRs merge straight to `main` |
| `dev` | Exists on remote but stale/unused — recent PRs target `main` directly, not `dev` |
| `claude/adoring-knuth-u8uskn` | Current Claude Code session (scheduled docs-sync task) |

---

## In progress

_(nothing active — this session's only task is the CLAUDE.md/memory.md sync below)_

---

## Feature flag status

There is no static `FEATURES` flag object anymore (removed as dead code — see `docs/adr/README.md`'s "Feature entitlements" key decision). Module gating is now two separate per-org registries, both mirrored across frontend/edge/SQL and kept in sync in the same PR:

- **Entitlements** ("does this module exist for this org") — `src/lib/entitlements.ts` `FEATURE_REGISTRY`, currently including `booking_flow` and `hire_orders`. Toggled per org from Platform → Organizations → Edit org → Modules; `hire_orders` ships dark (defaults off).
- **Capabilities** ("who may act within an enabled module") — `src/lib/capabilities.ts` `CAPABILITY_DEFS`, 27 producer capabilities, resolved lock → org override → platform default → registry default.

`AUTO_SUGGEST`, `UNDERSTUDY`, and `AUDIT_TRAIL` were never real flags in this model — they're just always-on booking-engine/audit behavior, unconditional as long as `booking_flow` itself is entitled. `NOTIFICATIONS` likewise isn't a toggle; the `notifications` table is always present. Airtable sync is enabled per-org via `airtable_sync_enabled` in `app_settings` (unchanged).

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No prod seed-test-data edge function | Dev setup friction (production/staging only) | Must bootstrap first org admin out-of-band (Supabase dashboard); org admin then invites others via Admin → Invites. **Local dev is no longer affected** — since 2026-08-08 the local Supabase stack (`npm run local:up`) auto-applies `supabase/seed.sql`, seeding logins `admin@`/`producer@`/`artist@example.com` (password `showflow-dev`); see `docs/runbooks/local-development-stack.md`. |
| Releases since `v1.9.0` are untagged | Process gap | `package.json`/changelog are at `1.15.0` (Aug 8). Tagging *was* caught up once already — `v1.4.1`–`v1.9.0` were all cut in one batch on 2026-07-15 — but versions `1.9.1`–`1.15.0` have shipped since with no corresponding `git tag`. Catch up again when convenient. |

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
| 2026-07-15 | Booking flow is fully configurable per org (presets + tunable steps), not a fixed lifecycle | Different producers run booking very differently (tiered offers vs. direct book vs. fast-track); hardcoding one flow forced everyone into the same shape. See `docs/adr/README.md`'s `booking_flow` key decision |
| 2026-07-23 | Per-org capabilities ("user group rights") layered on top of entitlements: `src/lib/capabilities.ts` registry, `resolveCapability` (lock → org override → platform default → registry default) | Entitlements answer "does this module exist"; capabilities answer "who may act within it" — orgs wanted producers to do more (or less) than the fixed role split allowed. Full rationale in `docs/adr/README.md` |
| 2026-08-06 | Tenant-table list reads are scoped to the *actively viewed* org, not just "any org the user belongs to" (`org_isolation` narrowed to `x-active-org`) | `is_org_member()`/RLS alone doesn't narrow to the current org for super-admins and multi-org members — several list reads (`casts`, `blockedDates`, `showAssignments`, and others) were silently returning cross-org rows to those callers before this fix |
| 2026-08-06 | `booking_flow` promoted from "always-on logic" to a fully entitlement-gated module, enforced at all three layers (RESTRICTIVE RLS write-gate policies, edge `requireFeature`/`checkFeature`, UI `ModuleGate`/route lock) | A single UI gate could be bypassed by calling an edge function or RPC directly; enforcing at RLS too closes that gap. `checkFeature` deliberately fails OPEN for this one feature only, since a transient RPC error must never silently take live booking traffic down |
| 2026-08-08 | Local Docker-free dev/CI inner loop is the default workflow (`npm run local:up`, `verify:fast`/`verify:full`, pre-push hook running `verify:fast`) | Lets agents and contributors iterate against a real seeded Postgres/Auth stack without touching production data or waiting on full CI for every change |
| 2026-08-18 | Removed the auto-installed `pre-push` hook (deleted `.githooks/pre-push`, the `prepare` npm script's `core.hooksPath` wiring, and `scripts/prePushHook.test.mjs`). `verify:fast`/`verify:full`/`scan:secrets` are now invoked manually | The hook's checks all run in CI on every PR push anyway (the enforced gate), and gating pushes behind a slow local `verify:fast` was friction the owner opted out of. `verify-cache.mjs`/`verify.sh`/`scan-secrets.mjs` stay as manual tools |

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
| 2026-08-10 | Updated `CLAUDE.md` and `memory.md` — a scheduled audit found ~275 commits and a dozen releases (`1.8.0`→`1.15.0`) of drift since the last sync. Fixed: `src/components/`, `src/data/`, `src/hooks/`, `src/pages/` architecture-tree lists (11 new component subdirs, 9 new data domains, 14 new hooks, 8 new pages); edge functions section (added `send-login-link`, `email-health-watcher`, `platform-list-users`, `platform-manage-user`, flagged `documenso-webhook` as retained-but-dark); Key files table (`platformUsers.ts`, `authLinks.ts`); the dev-server port (was documented as 5173, actually 8080); the versioning section's tag range (accurate as of the 2026-07-06 sync, since stale: verified against the unshallowed remote that `v1.4.1`–`v1.9.0` were batch-tagged on 2026-07-15, so only `v1.9.1`–`v1.15.0` are actually untagged today); the "producer" role's UI relabel to "Production Team"; a pointer from the Booking workflow section to the `booking_flow` entitlement gate; the pre-push `verify:fast` hook; and replaced the stale `FEATURES`-flag table in this file with a pointer to the current entitlements + capabilities registries. Current app version: `1.15.0` |
| 2026-08-09 | Magic-link login: "email me a sign-in link" on the login page, `send-login-link` edge function (existence-hiding, throttled via `auth_link_throttle`/`claim_login_link_slot`), `/auth/callback` landing route, `src/data/authLinks.ts`; existing-user invites now mint a magic link instead of bouncing through password reset (culminates in #238) |
| 2026-08-08–09 | Admin People pane convergence — unified Invites + Members into one searchable tab (`src/components/admin/people/`), bounded-concurrency bulk invite, server-side dedup (member check + partial unique index on pending invites), legacy `?tab=` param rewritten |
| 2026-08-09 | "Production Team" role relabel (#234) — the `producer` DB role/enum is unchanged, only `ROLE_LABELS` display text changed; artist contact-privacy RLS hardening (#228); cron dispatch host resolved per-environment from a table instead of a GUC (#230); System Health Layer B unauthorized-401 fix (#231); module onboarding collapse-to-bar — setup rails now collapse to a bar with checklist-button fallback (#235, #237) |
| 2026-08-07–08 | v1.15.0 "Dashboard first run" (#220) — welcome panel + on-demand setup checklist that adapts to enabled modules, sample-data preview until a workspace has real bookings; editor "view-as" now respects disabled-module gates (#215, #216); shared `IconTooltip` helper (#214) |
| 2026-08-08 | Local dev/CI inner loop: `npm run local:setup/up/down/reset`, two-tier `verify:fast`/`verify:full`, pre-push hook running `verify:fast`, `docs/runbooks/local-development-stack.md` (#221, #224); email templates coverage + `EmailTemplateEditorPage` WYSIWYG editor over `email_copy`/`email_theme`, redesigned live transactional emails, `edit_email_templates` capability (#223); editor-mode platform-entry fix (#225) |
| 2026-08-06–07 | v1.14.0 "Show date cockpit" (#217–#219) — `ShowDateDetailSheet` redesigned into a header/rail/tabs cockpit (`src/components/shows/date/`), hover/keyboard row-peek on the bookings list, hire-order and bookings guided setup checklists (#213), dry-run offer preview, ready-made terms templates, an upcoming/past/all-time filter across bookings/hire-orders/availability |
| 2026-08-06 | `booking_flow` promoted to a fully entitlement-gated module (RLS write-gate policies + edge `requireFeature` + UI `ModuleGate`/route lock); cross-org list-read hardening — every tenant-table list read now scoped to the actively-viewed org, not just any org the caller belongs to (`org_isolation` narrowed to `x-active-org`); editor org selector + changelog link on the version pill (#207, #208) |
| 2026-08-04–05 | System Health 30-day uptime bar backed by the `health-rollup` durable daily-count cron (#203, #204); CI coverage-gate de-duplication + raised thresholds (#205) |
| 2026-07-25 | v1.13.0 "Clearer fees on multi-date hire orders" — fee-per-date vs. fee-total toggle with a live running total, fee breakdown printed on the PDF, and the hire-order PDF template WYSIWYG editor (Settings → Hire orders → PDF template) (#198) |
| 2026-07-24 | v1.12.0 "More flexible hire orders" — named/custom terms templates, per-date running orders with their own session times, editable hire-order PDF wording, uploaded booking-agent signature, "start a hire order" shortcuts on Shows & Bookings |
| 2026-07-23 | v1.11.0 "Granular producer permissions" — the capabilities model ships: Settings → Roles & permissions, 27-capability registry (`src/lib/capabilities.ts`), invite resend/revoke moved onto the Artists page for producers |
| 2026-07-21–22 | v1.10.1–v1.10.3 reliability + UX fixes — grouped Settings side-nav, endless-loading-spinner-on-multi-tab fix, locked (not hidden) sidebar items for disentitled modules, restored auto-open of first offer tier on new show dates |
| 2026-07-18 | v1.10.0 "Paperwork that writes itself" — Hire orders ships: `generate-hire-orders` draft/issue/preview engine, spreadsheet import, the Hire orders list page, guided new-order wizard, split field/PDF-preview draft editor, optional (dark-by-default, later retired) Documenso countersigning |
| 2026-07-15 | v1.9.0 "Make the booking flow your own" — the booking-flow model ships: presets (Classic/Fast-track/Direct-book) + a tunable editor, direct-booking and fast-track modes, offer-expiry reminders, auto-escalation between tiers, dry-run preview, configurable reference field, settings change-history audit, dashboard attention cards, show-specific cast-priority overrides, required skills gating offers/direct-book/availability, skill-aware understudy promotion. Tags `v1.4.1`–`v1.9.0` were all cut in one catch-up batch this same day. |
| 2026-07-11 | v1.8.2 — dark mode (Light/Dark/System toggle); invitation/notification emails now deep-link into the app instead of the marketing site |
| 2026-07-06 | v1.8.1 — fixed Airtable poll interval reverting to 5 minutes after other settings saves; updated `CLAUDE.md` and `memory.md` — closed a month-long doc gap (two prior sync attempts, #116 and #142, were closed unmerged): fixed `src/data/` domain list, `src/hooks/` list, `components/platform/` and `components/settings/` trees, the `close-offer-tier`/`open-offer-tier` "cron function" ambiguity flagged in #142's review, `src/data/account.ts` key-files row, and the versioning section's stale tag range. Current app version: `1.8.0` |
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
