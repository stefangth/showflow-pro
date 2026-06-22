# CLAUDE.md — Showflow Pro

Guidance for AI coding agents (Claude Code and others) and new developers. Read this before writing any code.

> Do **not** put secrets, API keys, sprint goals, or current task lists here. See `memory.md` for living project state.

---

## What this project is

**Showflow Pro** is an artist booking SaaS for live show productions. Producers schedule shows and dates; artists declare availability; the system suggests, soft-books, and confirms bookings — replacing spreadsheets and email chains.

Scale target: 50+ active shows, 200+ artists, multi-venue.

---

## Tech stack

- **Frontend:** React 18, Vite 5, TypeScript 5
- **Styling:** Tailwind CSS v3 + shadcn/ui (Radix primitives), `framer-motion` for animation
- **Routing:** `react-router-dom` v6
- **Data:** `@tanstack/react-query` v5 for all server state
- **Forms:** `react-hook-form` + `zod`
- **Backend:** Supabase (external project, **not** Lovable Cloud) — Postgres, Auth, Edge Functions, Realtime
- **Notifications:** `sonner` (toasts), in-app `notifications` table

---

## Build / test / lint

```bash
npm install          # or bun install
npm run dev          # local dev server (Vite, port 5173)
npm run build        # production build
npm run lint         # eslint
npx vitest run       # unit tests (vitest + jsdom; setup in src/test/setup.ts)
npm run test:watch   # vitest watch mode
```

Edge functions deploy automatically when files in `supabase/functions/<name>/` change. No manual deploy step.

---

## Environment setup

Create a `.env` file at the repo root with:

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

These are public values (anon key, not service role). Never commit `.env`. The service role key is used only inside edge functions via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

---

## Git workflow

- **Branch naming:** `feature/<short-desc>`, `fix/<short-desc>`, `claude/<short-desc>`
- **Commit messages:** imperative, lowercase, ≤72 chars (e.g. `add artist availability calendar`)
- **Claude Code sessions** develop on the branch specified at session start (see `memory.md` for current active branch).

---

## Versioning & changelog

- **Semver tags on releases.** Tag the release commit `vMAJOR.MINOR.PATCH` (`git tag -a v1.4.0 -m "<theme>"` then `git push origin --tags`). MINOR = new user-facing features, PATCH = fixes, MAJOR = breaking changes. Tags `v1.0.0`–`v1.4.0` cover Apr–Jun 2026.
- **Bump the version in two places to match the tag:** `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` (the latter renders next to the brand name in the top-left of `AppLayout`).
- **Update `public/changelog.md`** (the single source of truth). Add a newest-first block: `## X.Y.Z — Mon D, YYYY`, a one-line `*theme*`, then `### New` / `### Improved` / `### Fixed` bullets written for end users (no refactors, tests, CI, or docs). Bullets use the form `- **Title** — description`.
- **Regenerate the JSON:** `deno run --allow-read --allow-write scripts/changelog-to-json.ts` rewrites `public/changelog.json` from the markdown — never hand-edit the JSON.
- **Both files are served publicly** at `/changelog.md` and `/changelog.json` with `Access-Control-Allow-Origin: *` (see `vercel.json`) and consumed by the standalone landing-page repo. Don't rename or move them without updating the landing page.

---

## Architecture

```
src/
  components/
    admin/         # Admin-only UI (InvitesTab — org invite management;
                   #   MembersTab — org member list + removal)
    artists/       # ArtistProfileSheet
    availability/  # ArtistAvailabilityCalendar, AvailabilityPicker, OfferResponseButtons
    bookings/      # ArtistBookingsView and booking surfaces
    brand/         # StageMark — brand mark SVG (variants: mono outline "mark", violet tile "tile")
    calendar/      # EntityCalendar (shared month grid)
    casts/         # Cast grouping UI (dialog, sheet, section)
    chat/          # ChatPanel, MessageBubble (per-show-date threads)
    consent/       # CookieConsentBanner (bottom-fixed GDPR banner), CookieConsentDialog (per-category toggles)
    dashboard/     # Role-specific dashboards (ArtistDashboard, …)
    filters/       # Reusable filter/sort/view-toggle controls
    platform/      # Super-admin platform console UI (OrganizationsTab, PlatformAdminsTab,
                   #   PlatformDefaultsTab, EditOrgDialog, NewOrgDialog, OrgInvitePopover,
                   #   OrgMembersPopover) + pure utilities (platformFormat.ts, templateText.ts)
    catalog/       # Production catalog CRUD: ShowFormDialog (create/edit shows) + ProductionsPage support
    shows/         # ShowDateDetailSheet — the full per-date booking management surface;
                   #   ShowDateFormDialog — create/edit show_dates (in-app)
    settings/      # AirtableSyncTab — Settings → Airtable Sync tab (schema-driven mapping + catalog linking)
    layout/        # AppLayout (sidebar + topbar shell), NotificationsList (notification bell popover)
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # Feature flags (FEATURES), route constants (ROUTES), BOOKING_ENGINE_DEFAULTS, CHAT_ARCHIVE_DAYS
  data/            # Data-access layer: fetchX(client, args) / mutateX(client, args) functions
                   #   that take the Supabase client as a parameter. Hooks are thin wrappers.
                   #   Domains: artists, invitations, members, notifications, orgs, platform,
                   #   profiles, settings, shows, showDates, skills. Test with supabaseFake.ts (never vi.mock the client).
  features/
    auth/          # AuthContext (org-aware: currentOrg/orgs/switchOrg, isSuperAdmin),
                   #   ProtectedRoute (org gate → NoOrgScreen / SuspendedOrgScreen;
                   #   super-admins bypass org gate and suspended-org check),
                   #   PlatformRoute (super-admin-only gate for /platform, no org required),
                   #   orgRoles.ts (multi-org role utilities),
                   #   resetPassword.ts (pure hash-parse / redirect-safety / schema helpers)
    consent/       # ConsentContext, ConsentProvider, useConsent hook — localStorage-backed GDPR consent state
                   #   (key: showflow.consent.v1; categories: analytics, sessionReplay, errorTracking)
                   #   ConsentProvider wraps the routing tree (inside BrowserRouter, outside AuthProvider/EditorProvider).
    editor/        # Admin-only UI editor: EditorContext, EditorToolbar, EditorSidePanel,
                   #   ColumnLayoutEditor, columnRegistries, types.
                   #   Persists page access / column templates / table permissions in
                   #   app_settings (keys: editor_page_access, editor_column_templates,
                   #   editor_table_permissions). EditorProvider wraps the whole app.
                   #   Read-only hook for page components: useEditorConfig().
  hooks/           # Domain hooks (useMyArtist, useEligibleArtists, useChatParticipant,
                   #   useArtistEligibleDates, useSettingsWarnings,
                   #   useSkills/useArtistSkills, useNotifications/useMarkNotificationRead/
                   #   useMarkAllNotificationsRead, useMyProfile/useUpdateMyProfile,
                   #   useOrgMembers/useRemoveOrgMember,
                   #   useShows/useShowDates/useCities) + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  lib/             # Shared utilities: utils.ts (cn helper), dates.ts (parseDateOnly,
                   #   formatDateDMY, formatDateWithWeekday, toDateKey — all timezone-safe),
                   #   avatar.ts, bookings.ts, catalog.ts (isSyncedShow/Date, canHardDeleteShow/Date),
                   #   settings.ts (dedupeProgramPairs, effectiveSlots)
  pages/           # One file per route, default-exported
                   #   Key pages: DashboardPage, ShowsBookingsPage (ROUTES.BOOKINGS),
                   #   ProductionsPage (ROUTES.PRODUCTIONS) — admin+producer catalog CRUD + drag-reorder,
                   #   ArtistsPage (admin+producer), AvailabilityPage (artist),
                   #   AdminPage, SettingsPage, ChatsListPage
                   #   ProfilePage (ROUTES.PROFILE) — user profile + in-app password change
                   #   ResetPasswordPage (ROUTES.RESET_PASSWORD) — request + set (public, no auth)
                   #   PlatformPage (ROUTES.PLATFORM) — super-admin console; uses PlatformRoute
                   #   Public pages (no auth): UnsubscribePage, PrivacyPage, ImpressumPage,
                   #   AcceptInvitePage, ResetPasswordPage
                   #   /signup redirects to /login (no standalone signup page).
  types/           # Domain types extending Supabase row types
docs/
  app-logic.md    # Domain guide (roles, data model, booking flow) — for admins/producers
  legal/          # Privacy policy + impressum in EN/DE (served by PrivacyPage, ImpressumPage)
supabase/
  functions/       # Deno edge functions
    _shared/transactional-email-templates/  # React Email templates + registry
  migrations/      # SQL migrations — read-only, generated via the migration tool
```

### Key decisions

- **Single source of truth for routes/flags:** `src/config/app.config.ts`. Reference `ROUTES.X` rather than string literals. `CHAT_ARCHIVE_DAYS` (30) hides chats from the list and gates write access after a show date passes (chats older than 30 days are hidden from `ChatsListPage` for non-admins and made read-only in `ChatPanel`). Note: `ROUTES.SHOWS` (`/shows`) has been removed — the `/shows` path no longer exists. `ROUTES.PRODUCTIONS` (`/productions`) is the in-app catalog management page (admin + producer).
- **Admin-tunable settings live in the DB:** the `app_settings` table (key/value JSONB, `org_id` column) is edited via the Settings page. Static developer-only constants stay in `app.config.ts`. Settings are **per-org with platform-default fallback**: `get_org_setting(_key, _org)` (DB) / `resolveOrgSetting(client, orgId, key, fallback)` (frontend in `src/data/settings.ts`; edge functions in `_shared/settings.ts`) returns the org's own row when it exists, otherwise the platform-default row (`org_id IS NULL`). Write org overrides with `upsertOrgSetting`; write platform defaults with `savePlatformSetting` (super-admin only). The schema key is `ON CONFLICT (org_id, key)`.
- **Onboarding is invite-only.** There is no public signup and no approval queue. An org admin invites a person by email via the `create-invitation` edge function (inserts `org_invitations` + sends the `org-invitation` email with an `/accept-invite?token=` link); the invitee accepts via the `accept_invitation` SECURITY DEFINER RPC, which writes their `org_memberships` row. `ProtectedRoute` gates on membership: no active org → `NoOrgScreen`; suspended org → `SuspendedOrgScreen`. (The old `user_approvals` / `ApprovalGate` / `admin-decide-approval` flow was retired.)
- **Role checks are always server-enforced via RLS.** The client `useAuth().hasRole(...)` is for UX only (hiding nav, gating pages); never trust it for data access.
- **Roles live in `org_memberships`** (per-org: `(org_id, user_id, role)`), never on `profiles`. Check via the `has_org_role(uuid, org_id, app_role)` / `is_org_member(uuid, org_id)` security-definer functions in policies (both short-circuit on `is_super_admin`). The old global `user_roles` table + `has_role()` were dropped. `AuthContext` derives the active org's roles, so `useAuth().hasRole()` keeps its signature.
- **Super-admins (`platform_admins` table) bypass org gates.** `is_super_admin(_uid)` is a SECURITY DEFINER function used by RLS and by `requireOrgRole` / `requireSuperAdmin` in `_shared/auth.ts`. In the frontend `AuthContext` this surfaces as `isSuperAdmin: boolean`. Super-admins: (a) skip `ProtectedRoute`'s org-membership and suspended-org checks; (b) see all orgs in the switcher via `fetchAllOrgs`; (c) can enter `/platform` (gated by `PlatformRoute`). Manage super-admins via `add_platform_admin(email)` / `remove_platform_admin(user_id)` RPCs (last-admin guard is race-resistant). Edge endpoints that need super-admin authority call `requireSuperAdmin(deps, req)` from `_shared/auth.ts`.
- **Chat is per show-date.** One `chats` row per `show_date_id`; participation is gated by `is_chat_participant(chat_id, user_id)` (admins, producers, and artists booked/soft-booked for that date). After `CHAT_ARCHIVE_DAYS` days, chats are hidden from `ChatsListPage` for non-admins and become read-only in `ChatPanel` (admins can still view the archived thread).
- **Artist availability is gated by eligibility.** Artists can only declare availability on dates returned by `useArtistEligibleDates` (derived from cast eligibility). Non-eligible dates render non-interactively in the calendar.
- **`show_dates.status` is DB-computed.** A Postgres trigger (`sync_show_date_status_trigger` on `bookings`) automatically sets status to `open | partially_filled | fully_filled` based on confirmed booking counts vs the `main_cast_slots` + `understudy_slots` columns on `shows`. Only `cancelled` is set by mutations directly. Do not set status manually in client code. A trigger on `shows` recomputes that show's dates when its `program`, `sub_program`, `main_cast_slots`, or `understudy_slots` change.
- **Slot capacity lives on `shows`.** Each show row carries `main_cast_slots` and `understudy_slots` (nullable smallint; `NULL` = unconfigured → the date never reaches `fully_filled` and the UI shows an "Unconfigured" badge). There is no `slots_per_date` column and no `app_settings.sub_program_slots_defaults`. The frontend reads these columns via `showSlots(show)` (from `src/lib/settings.ts`) on the already-joined show row — no separate query needed. Slot configuration is edited on the **Productions** page (the old Settings → Scheduling editor was replaced by a pointer); `shows.sort_order` (smallint) drives the Productions drag-reorder.
- **In-app catalog & date management.** Admins/producers create/edit/archive/reorder **productions** (`shows`) on the **Productions** page (`ROUTES.PRODUCTIONS`, `/productions`) and create/edit/cancel/delete **show_dates** via `ShowDateFormDialog` (create) + `ShowDateDetailSheet` (edit/cancel/delete). Airtable-synced rows are **locked** for the fields the poll manages (synced dates: date/sessions/venue/city read-only, notes editable (status is DB-computed); synced shows: program/sub_program read-only, slots/description/category editable); manual rows are fully editable. Deletes are gated: a date hard-deletes only with **zero bookings** (otherwise **Cancel**, which cascades booking release + notifies); a show hard-deletes only with **zero dates** (otherwise **Archive**) — note `show_dates.show_id` is `ON DELETE CASCADE`. Data-access: `src/data/shows.ts`, `src/data/showDates.ts`; pure guards: `src/lib/catalog.ts` (`isSyncedShow/Date`, `canHardDeleteShow/Date`).
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
- **Airtable sync is org-aware.** The `airtable-poll` edge function upserts `show_dates` from Airtable and is scheduled via pg_cron (`*/5 * * * *`). Enable per-org by setting `airtable_sync_enabled = true` in `app_settings` for that org (via Settings → Airtable) and configuring `airtable_base_id`, `airtable_table_name`. The Airtable API key is stored per-org in **Supabase Vault** (not a global edge function secret) — see the `get_org_airtable_key` / `set_org_airtable_key` RPCs and the `20260604131000_org_airtable_vault.sql` migration. Catalog linking (Phase 2b) connects Airtable controlled-option values to catalog rows via `shows.airtable_program_key` and `cities.airtable_city_key` — grain-agnostic `text`, **unique per org** (partial index where not null). The link grain (a single sub-program option vs a Program+Sub-Programm composite) is chosen by the admin in the mapping UI, not fixed in the DB (2b-UI links **sub-program-only**; the composite path is deferred). The Settings → Airtable Sync tab (`src/components/settings/AirtableSyncTab.tsx`) drives schema-based base/table/field selection (dropdowns from `airtable-schema`, typed fallback when the PAT lacks `schema.bases:read`), writes `app_settings.airtable_field_map`, and does catalog linking (import-all + unlink). City link keys are **case-insensitive** (`buildCityKey` = trim+lowercase via the shared `normalizeCityName`), so **"Import all" auto-links** an Airtable option to an existing same-name city instead of creating a duplicate, and each unlinked option has a per-row "link to existing city" control. The dead "Filter Mappings" Settings card was removed.
- **Feature flags** live in `app.config.ts` as the `FEATURES` object. Check with `if (FEATURES.FEATURE_NAME) { ... }`. Wrap entire feature blocks, not individual lines. Don't build UI for a flag that's `false` unless wiring it up in the same change.
- **Admin-only editor mode:** `EditorProvider` (wraps the entire app in `App.tsx`) exposes `isEditorMode`. Admins in editor mode bypass route-level role gates — `ProtectedRoute` reads `pageAccess` from `useEditorConfig()` and uses DB-stored role overrides instead of the `requiredRoles` prop. Never use `isEditorMode` to skip server-side RLS checks.
- **GDPR consent system:** `ConsentProvider` wraps the routing tree in App.tsx (inside BrowserRouter, outside AuthProvider/EditorProvider). `CookieConsentBanner` is rendered globally inside `ConsentProvider`; it is visible when `!hasDecided` and while the preferences dialog is closed (`!preferencesOpen`). Consent choices (analytics, sessionReplay, errorTracking) are persisted in `localStorage` under `showflow.consent.v1`. Read choices via `useConsent()`. Only wire analytics/session-replay/error-tracking SDKs based on the returned flags — never call them unconditionally.
- **Public routes:** `ROUTES.PRIVACY` (`/privacy`), `ROUTES.IMPRESSUM` (`/impressum`), `ROUTES.UNSUBSCRIBE` (`/unsubscribe`), `ROUTES.ACCEPT_INVITE` (`/accept-invite`), and `ROUTES.RESET_PASSWORD` (`/reset-password`) are rendered outside `ProtectedRoute` — no auth required. The legal docs are loaded from `docs/legal/*.md` via Vite `?raw` imports and rendered with `ReactMarkdown` + `remarkGfm`.

### Calendar conventions

- **Week starts on Monday everywhere.** When using shadcn `Calendar` / `DayPicker`, pass `weekStartsOn={1}`. For manually rendered month grids, compute the leading pad as `(monthStart.getDay() + 6) % 7` and order weekday headers Mon–Sun.

---

## Conventions

### Naming

- **Files:** `PascalCase.tsx` for components/pages, `camelCase.ts` for hooks/utilities, `kebab-case` for shadcn primitives (existing convention).
- **Components:** `PascalCase`. Pages export default; everything else named export.
- **Hooks:** `useThing`.
- **DB:** `snake_case` tables and columns. Enum types in `app_role`, `booking_status`, etc.
- **Routes:** define in `ROUTES`, kebab-case URLs.

### React / data

- Use `useQuery` for reads, `useMutation` for writes; invalidate the relevant `queryKey` on success.
- **Query key convention — hierarchical prefix by domain:** All keys follow `['domain', 'sub-key', ...params]`. The two most critical domains:
  - **`['bookings', ...]`** — everything that reads from the `bookings` table (e.g. `['bookings', 'for-date', id]`, `['bookings', 'status']`, `['bookings', 'artist', artistId]`).
  - **`['availability', ...]`** — everything that reads from the `availability` table (e.g. `['availability', 'cell', artistId, date]`, `['availability', 'available', dateId]`).
- **Invalidation rule:** Mutations that write to `bookings` invalidate `['bookings']` (prefix match, catches all sub-keys). Mutations that write to `availability` invalidate `['availability']`. This is the only pattern that stays correct as new consumers are added. Never list individual sub-keys in a mutation — always bust the whole domain.
- **Supabase Realtime is enabled** on all primary tables. Booking status changes propagate automatically to subscribed clients.
- Prefer the existing domain hooks in `src/hooks/` (`useMyArtist`, `useEligibleArtists`, `useArtistEligibleDates`, `useChatParticipant`, `useSettingsWarnings`, `useSkills`/`useArtistSkills`, `useNotifications`) over duplicating Supabase queries inline.
- Never call Supabase from a component effect when a query will do.
- Side effects on success → `sonner` toast (`toast.success`, `toast.error`).

### Error handling & loading states

- Use React Query's `isLoading`, `isError`, `error` states — no ad-hoc local loading flags.
- Show `Skeleton` (shadcn) for loading cards; show `Alert variant="destructive"` for page-level errors.
- Edge function errors: return `{ error: "message" }` with appropriate HTTP status; surface to the client via `toast.error`.

### New page / route checklist

When adding a new page:
1. Add a route constant to `ROUTES` in `src/config/app.config.ts`.
2. Create `src/pages/YourPage.tsx` with a default export.
3. Register in `src/App.tsx` with `<ProtectedRoute requiredRoles={[...]}>`.
4. Add a nav item in `src/components/layout/` with matching role gating.

### Edge functions

- One folder per function under `supabase/functions/<name>/index.ts`. Current categories:
  - **Admin ops:** `admin-list-users` (org-scoped via `?org_id` / body `org_id`). Member role changes are the `set_org_member_role` RPC (not an edge function).
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email). Acceptance is the `accept_invitation` RPC, not an edge function.
  - **Airtable sync:** `airtable-schema` (admin-only, user-JWT via `requireOrgRole(org_id, ['admin'])`) reads the org's Airtable schema with the Vault PAT for the mapping UI — returns `{ schemaAccessible, bases }` (no `baseId` in body) or `{ schemaAccessible, tables }` (with `baseId`); an Airtable `403` (PAT missing the `schema.bases:read` scope) surfaces as `{ schemaAccessible: false }` so the UI falls back to typed inputs, and the PAT is never returned to the client. `airtable-poll` is the `*/5 * * * *` cron that upserts `show_dates` from each org's base (see the Airtable-sync decisions above).
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Booking engine:** `open-offer-tier` (create suggested bookings), `expire-offers` (hourly expiry), `send-offer-digest` (daily 19:00 Berlin), `send-confirmation-digest` (daily 20:00 Berlin). All cron functions are org-aware: they iterate active orgs via `getActiveOrgs(admin)` from `_shared/settings.ts` and resolve settings per-org with `resolveOrgSetting`.
  - **Watchers:** `tier-at-risk-watcher` — scans open offer tiers and fires an in-app `tier_at_risk` notification when remaining pending + accepted < required slots. Idempotent (one notification per date/tier). No email; visual only.
  - **Platform (super-admin):** `provision-org` (atomic org creation + catalog seeding + first-admin invite, requires super-admin); `resend-invitation` (resend an existing `org_invitations` row's email).
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first via `requireRole` (any-org), `requireOrgRole(org_id, [...])` (org-scoped), or `requireSuperAdmin` (platform-admin endpoints) from `_shared/auth.ts` — see `create-invitation` / `provision-org` for patterns. `requireOrgRole` automatically accepts super-admins so god-mode works on org-scoped endpoints.
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Notification system

- In-app notifications write to the `notifications` table (columns: `id`, `user_id`, `type`, `title`, `message`, `read` boolean, `related_entity_id`, `related_entity_type`, `created_at`). There is no `payload` column and no `read_at` timestamp — read state is a plain boolean `read`.
- `FEATURES.NOTIFICATIONS` must be `true` (it is, by default).
- Create notifications from edge functions or server-side mutations only — never bare client-side inserts without proper RLS policies.

### Styling

- **Use semantic tokens only**: `bg-background`, `text-foreground`, `text-primary`, `border-border`, etc. Never hardcode colors like `bg-white` or `text-black` in components.
- All design tokens live in `src/index.css` (HSL only) and `tailwind.config.ts`.
- Display font: `font-display` (Space Grotesk). Body: default Inter.
- Match the existing component patterns: `Card` for grouped content, `Tabs` for sectioned admin UIs, `Badge` for status pills.

### TypeScript

- Prefer types derived from `Database` in `src/integrations/supabase/types.ts` — see `src/types/index.ts` for extension patterns.
- `any` is allowed for Supabase joined-row shapes when typing them is disproportionate, but isolate to the boundary.

### Testing

**Test-first is the default.** For any new logic (a pure function, a data-access function, an edge-function branch), write the failing test before the implementation. Bug fixes start with a failing regression test that reproduces the bug.

**The five test layers and when to use each:**

| Layer | Tool | Runs via | Use for |
|---|---|---|---|
| Unit / hook | Vitest + jsdom + @testing-library/react | `npx vitest run` | Pure functions, data-access functions, hooks, components |
| Database | pgTAP | `supabase test db` | Triggers, RLS policies, RPCs (`supabase/tests/`) |
| Edge function | Deno test | `deno test --allow-all supabase/functions/` | Edge-function handlers + shared modules |
| End-to-end | Playwright | `npx playwright test --config=e2e/playwright.config.ts` | Critical cross-stack flows |

CI runs all of these (`.github/workflows/ci.yml`).

**Hard rule: tests import the real module.** Never re-implement production logic inside a test file. If logic is hard to import, that is a signal to extract it — not to copy it into the test.

**Frontend pattern — data-access extraction:** Put Supabase reads/writes in `src/data/<domain>.ts` as `fetchX(client, args)` / `mutateX(client, args)` functions that take the client as a parameter. Hooks are thin wrappers that pass the `supabase` singleton. Test the data-access functions with the call-recording fake client in `src/test/supabaseFake.ts`, and use `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts` for hook/component tests. Do not hand-roll `vi.mock('@/integrations/supabase/client')` chains.

**Backend pattern — dependency injection:** Each edge function exports `handle(req, deps)` and only wires `Deno.serve((req) => handle(req, realDeps()))` at the bottom. `Deps` (in `supabase/functions/_shared/deps.ts`) carries the Supabase clients, `env`, `now`, `invokeFunction`/`sendEmail`, and `fetch`. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`. Use the shared `_shared/http.ts` (CORS + json), `_shared/auth.ts` (requireRole / requireOrgRole / requireSuperAdmin / requireCronOrRole / isServiceRole), and `_shared/settings.ts` (resolveOrgSetting / getActiveOrgs) helpers — do not re-inline CORS, client creation, auth, or settings resolution.

- Co-locate tests beside the file they test.
- Test behavior, never implementation details (internal state, private methods).

### Database changes

- Schema changes go through the migration tool — never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Every new table needs RLS enabled and explicit policies. Default to `authenticated` role; on tenant tables restrict reads by `is_org_member(auth.uid(), org_id)` and writes by `has_org_role(auth.uid(), org_id, ...)` (the uniform org-isolation template), plus the RESTRICTIVE `org_isolation` policy.
- Use the `update_updated_at_column()` trigger on tables with `updated_at`.

---

## Booking workflow (domain rules)

A booking moves through: `suggested → soft_booked → confirmed` (or `cancelled` from any state).

**DB-enforced integrity:** at most one *active* (non-cancelled) booking exists per `(show_date_id, artist_id)` (partial unique index `bookings_active_artist_date_uniq`); and a booking's artist must belong to the same org as its show_date — enforced by the `derive_org_id_for_booking()` trigger, which re-derives `org_id` and re-checks on INSERT and on any UPDATE of `artist_id`/`show_date_id`. Don't rely on application-side dedup alone.

- Offers are created by `open-offer-tier` edge function (call after new show_date creation or manually).
- Artists have a configurable response window (default 48h) to respond; `expire-offers` runs hourly. The window duration, digest send hours (Berlin time), and other booking engine settings are stored in `app_settings` (editable via Settings → Booking Engine), not hardcoded in `app.config.ts`.
- Artists receive a daily offer digest email at the configured hour (default 19:00 Berlin).
- Producers see soft_booked rows in their dashboard and bulk-confirm.
- Artists receive a confirmation digest email at the configured hour (default 20:00 Berlin).
- Email provider: Resend. Template overrides editable in Settings → Booking Engine.
- Understudies (`is_understudy = true`) auto-promote when the primary cancels.

---

## Test accounts (development only)

Onboarding is invite-only, so there is no public signup. **Bootstrap the first super-admin** once per environment — the only setup step that needs SQL — per the runbook at `docs/runbooks/first-super-admin-bootstrap.md`: create the auth user (Supabase dashboard), then `insert into public.platform_admins (user_id) select id from auth.users where lower(email) = lower('owner@example.com')`. Sign in and you land in the **Platform console**, where **Organizations → New organization** provisions an org (seeds its starter catalog + emails the first admin an `/accept-invite?token=` link) with no SQL. That admin then invites producers/artists from **Admin → Invites**; each invitee accepts via the emailed link. There is no automated seeding function.

Suggested emails:
- `test-admin@showflowpro.com`
- `test-producer@showflowpro.com`
- `test-artist@showflowpro.com`

**Rotate or remove before any production deploy.**

---

## Key files to reference

| File | Purpose |
|------|---------|
| `src/config/app.config.ts` | FEATURES flags, ROUTES, BOOKING_ENGINE_DEFAULTS (canonical booking-engine fallbacks; mirrors `_shared/settings.ts`), CHAT_ARCHIVE_DAYS |
| `src/integrations/supabase/types.ts` | Auto-generated DB types — read only |
| `src/features/auth/AuthContext.tsx` | Auth state, org-scoped role helpers, `currentOrg`/`orgs`/`switchOrg`, `isSuperAdmin` |
| `src/features/auth/resetPassword.ts` | Pure helpers for reset-password flow (hash parse, redirect safety, schema) |
| `src/features/consent/ConsentContext.tsx` | GDPR consent state (analytics / sessionReplay / errorTracking) |
| `src/features/editor/EditorContext.tsx` | Editor mode state, page access and column/permission config (admin only) |
| `src/data/settings.ts` | `resolveOrgSetting` / `upsertOrgSetting` — org-aware settings resolver (frontend) |
| `src/data/platform.ts` | Super-admin data access: `fetchAllOrgs`, `provisionOrg`, `fetchPlatformOrgStats`, platform admin CRUD |
| `src/data/profiles.ts` | `fetchMyProfile` / `updateMyProfile` / `updateMyPassword` |
| `src/data/members.ts` | `fetchOrgMembers` / `removeOrgMember` (via `list_org_members` / `remove_org_member` RPCs) |
| `src/hooks/` | All domain hooks — reuse before writing new queries |
| `src/types/index.ts` | Domain type extensions on top of Supabase types |
| `supabase/functions/_shared/settings.ts` | `resolveOrgSetting` + `getActiveOrgs` — org-aware settings for edge functions |
| `supabase/functions/_shared/auth.ts` | `requireRole` / `requireOrgRole` / `requireSuperAdmin` / `requireCronOrRole` |
| `supabase/functions/provision-org/index.ts` | Atomic org creation + catalog seed + first-admin invite (super-admin) |
| `supabase/functions/send-offer-digest/index.ts` | Daily offer digest (Berlin 19:00 gate) |
| `supabase/functions/send-confirmation-digest/index.ts` | Daily confirmation digest (Berlin 20:00 gate) |
| `supabase/functions/airtable-poll/index.ts` | Org-aware Airtable → show_dates sync (per-org Vault key) |
| `supabase/functions/open-offer-tier/index.ts` | Creates suggested bookings for a date/tier |
| `supabase/functions/tier-at-risk-watcher/index.ts` | In-app notification when a tier can no longer fill before deadline |

---

## Things to avoid

- Editing files under `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Storing roles on `profiles`, or doing role checks via `localStorage`.
- Adding `WITH CHECK (true)` policies on log/audit tables.
- Hardcoding colors, fonts, or route strings.
- Defaulting calendars/grids to Sunday-first — week starts on Monday across the app.
- Letting artists declare availability on dates outside `useArtistEligibleDates`.
- Coupling client logic to a specific tenant or production brand — the platform is product-agnostic.
- Using ad-hoc `useState` loading flags when React Query's `isLoading` / `isError` will do.
- Re-implementing production logic inside a test file (tests must import the real module).
- Constructing a Supabase client, CORS headers, or auth checks inline in an edge function instead of using `realDeps()` / `_shared/http.ts` / `_shared/auth.ts`.
- Hand-rolling `vi.mock('@/integrations/supabase/client')` chains instead of the `src/test/` harness.
