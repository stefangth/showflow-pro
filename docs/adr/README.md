# Architecture Decision Records (ADRs)

This directory holds **Architecture Decision Records** — short documents that capture a
significant, hard-to-reverse decision, the context that forced it, the options we weighed,
and the consequences we accepted. They exist so future contributors (human or AI) can
understand *why* the system is shaped the way it is, not just *what* it does.

## When to write one

Write an ADR when a decision:

- is expensive or disruptive to reverse (data model, tenancy model, sync ownership), **or**
- chooses between credible alternatives that a reasonable person would question later, **or**
- establishes a convention the rest of the codebase must follow.

Routine, easily-reversible choices do **not** need an ADR — put those in the relevant spec
under `docs/superpowers/specs/`.

## Format

Use the template below (Nygard-style, lightly extended). One decision per file.

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Deciders:** who signed off

## Context
## Decision
## Options Considered
## Trade-off Analysis
## Consequences
## Action Items
```

## Conventions

- Filename: `NNNN-kebab-case-title.md`, zero-padded, monotonically increasing.
- Never edit the **Decision** of an Accepted ADR in place. To change course, write a new ADR
  and mark the old one `Superseded by ADR-XXXX`.
- Link ADRs to the spec(s) that implement them and vice-versa.

## Index

ADRs are numbered in the order they were **recorded**, not the order decided — see each ADR's
**Date**. ADRs 0002–0008 were recorded retroactively on 2026-06-16 from PR, migration, and
design-spec history; they capture decisions already shipped (multi-tenancy, roles, onboarding,
testing, DB-computed status, the availability→blocked_dates shift, and the removed show-date UI).
Where the original sources did not document the reasoning, the ADR says so and marks the rationale
as reconstructed.

| ADR | Title | Decision date | Status |
|-----|-------|---------------|--------|
| [0001](0001-airtable-system-of-record.md) | Airtable is the system of record; Showflow mirrors and maps | 2026-06-16 | Accepted |
| [0002](0002-testability-foundation.md) | Testability foundation — edge-function DI, data-access extraction, five test layers | 2026-06-01 | Accepted |
| [0003](0003-pooled-multi-tenancy-isolation.md) | Pooled multi-tenancy — denormalized `org_id`, RESTRICTIVE isolation, derive triggers | 2026-06-03 | Accepted |
| [0004](0004-per-org-roles.md) | Per-org roles in `org_memberships`; retire global `user_roles`/`has_role` | 2026-06-03 | Accepted |
| [0005](0005-invite-only-onboarding.md) | Invite-only onboarding; retire signup → approval queue | 2026-06-03 | Accepted |
| [0006](0006-db-computed-show-date-status.md) | `show_dates.status` computed in the database by triggers | 2026-05-13 | Accepted |
| [0007](0007-drop-availability-for-blocked-dates.md) | Drop `availability` in favour of `blocked_dates` | 2026-05-14 | Accepted |
| [0008](0008-no-show-date-creation-ui.md) | No in-app UI for creating show dates | pre-2026-06-03 | **Superseded 2026-06-23** (reversed in-place — in-app creation shipped, PR #118) |
| [0009](0009-extensible-synced-fields.md) | Extensible synced fields via per-entity JSONB + registry (not dynamic DDL) | 2026-06-16 | Accepted |
| [0010](0010-catalog-link-keys.md) | Catalog links are per-org opaque-key columns; link grain lives in the mapping layer, not the schema | 2026-06-17 | Accepted |
| [0011](0011-identity-contact-ownership.md) | Identity vs. booking-contact ownership — `profiles` vs `artists`, login-email-first resolution | 2026-06-17 | Accepted (amended 2026-06-20) |

## Key decisions (operational summary)

Moved here from the root `CLAUDE.md`. These are the **operational summary** of the project's architecture decisions — *what* each one is and *where* the code lives. The *rationale, alternatives, and consequences* for the hard-to-reverse ones are in the ADRs indexed above; where a bullet cites `(ADR-NNNN)`, that ADR is the source of truth for the *why* — read it before changing the behavior, and record a new ADR rather than reversing an Accepted one in place. Bullets without an ADR cite are operational conventions that, per *"When to write one"* above, don't warrant a dedicated ADR.

- **Single source of truth for routes/flags:** `src/config/app.config.ts`. Reference `ROUTES.X` rather than string literals. `CHAT_ARCHIVE_DAYS` (30) hides chats from the list and gates write access after a show date passes (chats older than 30 days are hidden from `ChatsListPage` for non-admins and made read-only in `ChatPanel`). Note: `ROUTES.SHOWS` (`/shows`) has been removed — the `/shows` path no longer exists. `ROUTES.PRODUCTIONS` (`/productions`) is the in-app catalog management page (admin + producer).
- **Admin-tunable settings live in the DB:** the `app_settings` table (key/value JSONB, `org_id` column) is edited via the Settings page. Static developer-only constants stay in `app.config.ts`. Settings are **per-org with platform-default fallback**: `get_org_setting(_key, _org)` (DB) / `resolveOrgSetting(client, orgId, key, fallback)` (frontend in `src/data/settings.ts`; edge functions in `_shared/settings.ts`) returns the org's own row when it exists, otherwise the platform-default row (`org_id IS NULL`). Write org overrides with `upsertOrgSetting`; write platform defaults with `savePlatformSetting` (super-admin only). The schema key is `ON CONFLICT (org_id, key)`.
- **Onboarding is invite-only (ADR-0005).** No public signup, no approval queue. An org admin invites a person by email via the `create-invitation` edge function (inserts `org_invitations` + sends the `org-invitation` email with an `/accept-invite?token=` link); the invitee accepts via the `accept_invitation` SECURITY DEFINER RPC, which writes their `org_memberships` row. `ProtectedRoute` gates on membership: no active org → `NoOrgScreen`; suspended org → `SuspendedOrgScreen`.
- **Role checks are always server-enforced via RLS.** The client `useAuth().hasRole(...)` is for UX only (hiding nav, gating pages); never trust it for data access.
- **Roles live in `org_memberships` (ADR-0004)** (per-org: `(org_id, user_id, role)`), never on `profiles`. Check via the `has_org_role(uuid, org_id, app_role)` / `is_org_member(uuid, org_id)` security-definer functions in policies (both short-circuit on `is_super_admin`). `AuthContext` derives the active org's roles, so `useAuth().hasRole()` keeps its signature.
- **Super-admins (`platform_admins` table) bypass org gates (ADR-0003).** `is_super_admin(_uid)` is a SECURITY DEFINER function used by RLS and by `requireOrgRole` / `requireSuperAdmin` in `_shared/auth.ts`. In the frontend `AuthContext` this surfaces as `isSuperAdmin: boolean`. Super-admins: (a) skip `ProtectedRoute`'s org-membership and suspended-org checks; (b) see all orgs in the switcher via `fetchAllOrgs`; (c) can enter `/platform` (gated by `PlatformRoute`). Manage super-admins via `add_platform_admin(email)` / `remove_platform_admin(user_id)` RPCs (last-admin guard is race-resistant). Edge endpoints that need super-admin authority call `requireSuperAdmin(deps, req)` from `_shared/auth.ts`.
- **Chat is per show-date.** One `chats` row per `show_date_id`; participation is gated by `is_chat_participant(chat_id, user_id)` (admins, producers, and artists booked/soft-booked for that date). After `CHAT_ARCHIVE_DAYS` days, chats are hidden from `ChatsListPage` for non-admins and become read-only in `ChatPanel` (admins can still view the archived thread).
- **Artist availability is gated by eligibility.** Artists can only declare availability on dates returned by `useArtistEligibleDates` (derived from cast eligibility). Non-eligible dates render non-interactively in the calendar.
- **`show_dates.status` is DB-computed (ADR-0006).** A Postgres trigger (`sync_show_date_status_trigger` on `bookings`) automatically sets status to `open | partially_filled | fully_filled` based on confirmed booking counts vs the `main_cast_slots` + `understudy_slots` columns on `shows`. Only `cancelled` is set by mutations directly. Do not set status manually in client code. A trigger on `shows` recomputes that show's dates when its `program`, `sub_program`, `main_cast_slots`, or `understudy_slots` change.
- **Slot capacity lives on `shows`.** Each show row carries `main_cast_slots` and `understudy_slots` (nullable smallint; `NULL` = unconfigured → the date never reaches `fully_filled` and the UI shows an "Unconfigured" badge). There is no `slots_per_date` column and no `app_settings.sub_program_slots_defaults`. The frontend reads these columns via `showSlots(show)` (from `src/lib/settings.ts`) on the already-joined show row — no separate query needed. Slot configuration is edited both in **Settings → Scheduling** (the *Slots per Show* editor) and on the **Productions** page (via the show create/edit dialog); `shows.sort_order` (smallint) drives the Productions drag-reorder.
- **In-app catalog & date management.** Admins/producers create/edit/archive/reorder **productions** (`shows`) on the **Productions** page (`ROUTES.PRODUCTIONS`, `/productions`) and create/edit/cancel/delete **show_dates** via `ShowDateFormDialog` (create) + `ShowDateDetailSheet` (edit/cancel/delete). *(The in-app **create** path reverses ADR-0008, which removed it assuming Airtable-only authoring — ADR-0008 is now marked **Superseded**.)* Airtable-synced rows are **locked** for the fields the poll manages (synced dates: date/sessions/venue/city read-only, notes editable (status is DB-computed); synced shows: program/sub_program read-only, slots/description/category editable); manual rows are fully editable. Deletes are gated: a date hard-deletes only with **zero bookings** (otherwise **Cancel**, which cascades booking release + notifies); a show hard-deletes only with **zero dates** (otherwise **Archive**) — note `show_dates.show_id` is `ON DELETE CASCADE`. Data-access: `src/data/shows.ts`, `src/data/showDates.ts`; pure guards: `src/lib/catalog.ts` (`isSyncedShow/Date`, `canHardDeleteShow/Date`).
- **Booking detail surface: `ShowDateDetailSheet`.** The full booking management experience (date config, assigned artists, available artists, chat) lives in `src/components/shows/ShowDateDetailSheet.tsx`. There is no standalone `/shows/:id` page — `ShowDetailPage` and `ShowDetailSheet` have been deleted.
- **Audit trail:** all booking status changes append to `booking_audit_log`. Never delete from this table.
- **Identity vs. booking contact (ADR-0011).** `profiles` (global, per auth user) owns login-user
  identity (`display_name`, personal `phone`; login email is
  `auth.users.email`). `artists` (per org) owns the bookable talent record + booking contact
  (`name` = talent label, `email`/`phone` = booking contact, `bio`, `status`, `cast_role` reserved);
  `user_id` is nullable (unregistered/external talent have no profile, so their contact MUST live on
  `artists`). The tables are **not** merged; `artists.cast_role` stays reserved (the once-reserved `profiles.avatar_url` was dropped 2026-06-20 — avatar feature cancelled). The resolution rule lives
  in `supabase/functions/_shared/identity.ts` (`resolveContactEmail` = login-email-first;
  `resolveAccountDisplayName` = display-name-first), re-exported by `src/lib/identity.ts`. The
  offer/confirmation digests address a registered artist at `coalesce(auth.users.email,
  artists.email)` via the service-role-only `resolve_user_contacts(uuid[])` function; the
  ArtistProfileSheet "Linked account" panel reuses the admin-only `list_org_members`.
- **Airtable sync is org-aware (ADR-0001, ADR-0010).** The `airtable-poll` edge function upserts `show_dates` from Airtable and is scheduled via pg_cron (`*/5 * * * *`). Enable per-org by setting `airtable_sync_enabled = true` in `app_settings` for that org (via Settings → Airtable) and configuring `airtable_base_id`, `airtable_table_name`. The Airtable API key is stored per-org in **Supabase Vault** (not a global edge function secret) — see the `get_org_airtable_key` / `set_org_airtable_key` RPCs and the `20260604131000_org_airtable_vault.sql` migration. Catalog linking (Phase 2b) connects Airtable controlled-option values to catalog rows via `shows.airtable_program_key` and `cities.airtable_city_key` — grain-agnostic `text`, **unique per org** (partial index where not null). The link grain (a single sub-program option vs a Program+Sub-Programm composite) is chosen by the admin in the mapping UI, not fixed in the DB (2b-UI links **sub-program-only**; the composite path is deferred). The Settings → Airtable Sync tab (`src/components/settings/AirtableSyncTab.tsx`) drives schema-based base/table/field selection (dropdowns from `airtable-schema`, typed fallback when the PAT lacks `schema.bases:read`), writes `app_settings.airtable_field_map`, and does catalog linking (import-all + unlink). City link keys are **case-insensitive** (`buildCityKey` = trim+lowercase via the shared `normalizeCityName`), so **"Import all" auto-links** an Airtable option to an existing same-name city instead of creating a duplicate, and each unlinked option has a per-row "link to existing city" control. The dead "Filter Mappings" Settings card was removed.
- **Feature flags** live in `app.config.ts` as the `FEATURES` object. Check with `if (FEATURES.FEATURE_NAME) { ... }`. Wrap entire feature blocks, not individual lines. Don't build UI for a flag that's `false` unless wiring it up in the same change.
- **Admin-only editor mode:** `EditorProvider` (wraps the entire app in `App.tsx`) exposes `isEditorMode`. Admins in editor mode bypass route-level role gates — `ProtectedRoute` reads `pageAccess` from `useEditorConfig()` and uses DB-stored role overrides instead of the `requiredRoles` prop. Never use `isEditorMode` to skip server-side RLS checks.
- **GDPR consent system:** `ConsentProvider` wraps the routing tree in App.tsx (inside BrowserRouter, outside AuthProvider/EditorProvider). `CookieConsentBanner` is rendered globally inside `ConsentProvider`; it is visible when `!hasDecided` and while the preferences dialog is closed (`!preferencesOpen`). Consent choices (analytics, sessionReplay, errorTracking) are persisted in `localStorage` under `showflow.consent.v1`. Read choices via `useConsent()`. Only wire analytics/session-replay/error-tracking SDKs based on the returned flags — never call them unconditionally.
- **Deletion & erasure (GDPR).** Account self-deletion **anonymizes-and-retains**: personal/login rows are hard-deleted, shared/audit rows are kept and de-identified (`artists` → tombstoned + unlinked; `booking_audit_log.performed_by` → null). `chat_messages` are **deleted** for the departed user (the column is `NOT NULL`, so in-place anonymization isn't possible without a schema change that would ripple into chat RLS + UI; messages are per-show-date and auto-archived, and the user receives them in their export first). Org deletion (`delete_org`, super-admin only) is a **hard tenant teardown** removing ALL of that org's rows **including its `booking_audit_log`** — the "never delete from `booking_audit_log`" rule is **per-org-lifetime** (it bars deleting audit rows during normal operation, not tearing down an entire tenant); members keep their global accounts. **If you add a new table with an `org_id`, add a matching `DELETE` to `delete_org` in FK-safe order** (cross-check: `select table_name from information_schema.columns where column_name='org_id'`). The last-admin guard blocks account self-deletion that would orphan an org.
- **Notification preferences.** Per-user, per-category × per-channel (email / in-app), opt-out default (missing row/key = enabled), stored in `notification_preferences.prefs` (jsonb, RLS own-row-only). The category model is `supabase/functions/_shared/notificationCategories.ts` (re-exported by `src/lib/notificationCategories.ts`). Email is gated in `send-transactional-email` (covers the digests, which send through it); in-app is gated by the `gate_notification_pref` BEFORE INSERT trigger on `notifications` via the `should_notify` + `category_of` SQL functions. Critical templates (invites, password reset) and unmapped notification types are never gated. Edited via the new ProfilePage "Notifications" card.
- **Public routes:** `ROUTES.PRIVACY` (`/privacy`), `ROUTES.IMPRESSUM` (`/impressum`), `ROUTES.UNSUBSCRIBE` (`/unsubscribe`), `ROUTES.ACCEPT_INVITE` (`/accept-invite`), and `ROUTES.RESET_PASSWORD` (`/reset-password`) are rendered outside `ProtectedRoute` — no auth required. The legal docs are loaded from `docs/legal/*.md` via Vite `?raw` imports and rendered with `ReactMarkdown` + `remarkGfm`.
