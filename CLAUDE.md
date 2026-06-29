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

Edge functions deploy automatically **on merge to `main`** via `.github/workflows/deploy-functions.yml`: the Supabase CLI deploys every function in `supabase/functions/` to the live project (`epweartpzwvcasrzyueh`). No manual deploy step for changes that land on `main`. When you add a **new** function, give it a `[functions.<name>]` block in `supabase/config.toml` (default `verify_jwt = true`; set `false` for public webhooks and cron callers that use `X-Cron-Secret`) — an unlisted function would deploy with JWT verification forced on and break those callers. To deploy off-cycle (a backfill, or before a merge) run the workflow manually (Actions → "Deploy Edge Functions" → Run workflow) or use the Supabase MCP `deploy_edge_function`. Removing a function still needs a manual `supabase functions delete <name>` — the deploy never deletes.

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

- **Semver tags on releases.** Tag the release commit `vMAJOR.MINOR.PATCH` (`git tag -a v1.6.0 -m "<theme>"` then `git push origin --tags`). MINOR = new user-facing features, PATCH = fixes, MAJOR = breaking changes. Tags `v1.0.0`–`v1.6.0` cover Apr–Jun 2026.
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
                   #   OrgMembersPopover, SystemHealthTab) + pure utilities (platformFormat.ts, templateText.ts)
    catalog/       # Production catalog CRUD: ShowFormDialog (create/edit shows) + ProductionsPage support
    shows/         # ShowDateDetailSheet — the full per-date booking management surface;
                   #   ShowDateFormDialog — create/edit show_dates (in-app)
    settings/      # AirtableSyncTab — Settings → Airtable Sync tab (schema-driven mapping + catalog linking;
                   #   autosaves via React Query, decoupled from the page's global Save/draft);
                   #   OrganizationTab — Settings → Organization tab (org rename for admins)
    layout/        # AppLayout (sidebar + topbar shell), NotificationsList (notification bell popover)
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # Feature flags (FEATURES), route constants (ROUTES), BOOKING_ENGINE_DEFAULTS,
                   #   SYSTEM_HEALTH / SYSTEM_HEALTH_BUDGET (platform health thresholds), CHAT_ARCHIVE_DAYS
  data/            # Data-access layer: fetchX(client, args) / mutateX(client, args) functions
                   #   that take the Supabase client as a parameter. Hooks are thin wrappers.
                   #   Domains: artists, airtableKey, airtableMapping, airtableSchema, airtableSettings,
                   #   airtableSync, bookings, cities, customFields, invitations, members, notifications,
                   #   notificationPreferences, orgs, platform, profiles, settings, shows, showDates, skills.
                   #   Test with supabaseFake.ts (never vi.mock the client).
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
                   #   useMarkAllNotificationsRead, useNotificationPreferences,
                   #   useMyProfile/useUpdateMyProfile,
                   #   useOrgMembers/useRemoveOrgMember,
                   #   useShows/useShowDates/useCities,
                   #   useNavCounts (role-aware badge counts for sidebar nav — head-count only),
                   #   useSystemHealth (System Health tab data)) + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  lib/             # Shared utilities: utils.ts (cn helper), dates.ts (parseDateOnly,
                   #   formatDateDMY, formatDateWithWeekday, toDateKey — all timezone-safe),
                   #   avatar.ts, bookings.ts, catalog.ts (isSyncedShow/Date, canHardDeleteShow/Date),
                   #   settings.ts (dedupeProgramPairs, effectiveSlots),
                   #   customFields.ts (custom-field helpers), identity.ts (user identity helpers),
                   #   notificationCategories.ts (re-exports shared category model from _shared/notificationCategories.ts),
                   #   systemHealth.ts (4-state derivation: Operational/Degraded/Down/Stale from p95/error-rate budgets)
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

The project's **key architecture decisions** — the operational *what / where*, plus links to the ADRs that carry the *why* — now live in **[`docs/adr/README.md`](docs/adr/README.md)** under *"Key decisions (operational summary)"*. They were moved out of this file so there is a single home for them. Read that section before changing data-model, auth, tenancy, sync, booking, or compliance behavior.

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
  - **`['blocked-dates', ...]`** — everything that reads from the `blocked_dates` table. *(Renamed from the old `['availability', ...]` domain when the `availability` table was dropped for `blocked_dates` — ADR-0007.)*
- **Invalidation rule:** Mutations that write to `bookings` invalidate `['bookings']` (prefix match, catches all sub-keys). Mutations that write to `blocked_dates` invalidate `['blocked-dates']`. This is the only pattern that stays correct as new consumers are added. Never list individual sub-keys in a mutation — always bust the whole domain.
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
  - **Airtable sync:** `airtable-schema` (admin-only, user-JWT via `requireOrgRole(org_id, ['admin'])`) reads the org's Airtable schema with the Vault PAT for the mapping UI — returns `{ schemaAccessible, bases }` (no `baseId` in body) or `{ schemaAccessible, tables }` (with `baseId`); an Airtable `403` (PAT missing the `schema.bases:read` scope) surfaces as `{ schemaAccessible: false }` so the UI falls back to typed inputs, and the PAT is never returned to the client. `airtable-poll` is the `*/5 * * * *` cron that upserts `show_dates` from each org's base (see the Airtable-sync key decision in `docs/adr/README.md`).
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Booking engine:** `open-offer-tier` (create suggested bookings), `close-offer-tier` (close a tier + optionally withdraw still-suggested bookings; auth: service-role or org admin/producer; `verify_jwt=true`), `expire-offers` (hourly expiry), `send-offer-digest` (daily 19:00 Berlin), `send-confirmation-digest` (daily 20:00 Berlin). All cron functions are org-aware: they iterate active orgs via `getActiveOrgs(admin)` from `_shared/settings.ts` and resolve settings per-org with `resolveOrgSetting`.
  - **Watchers:** `tier-at-risk-watcher` — scans open offer tiers and fires an in-app `tier_at_risk` notification when remaining pending + accepted < required slots. Idempotent (one notification per date/tier). No email; visual only.
  - **Cron health:** `cron-health-watcher` (runs every 15 min via `requireCronOrRole`; reads `net._http_response` via `cron_health_scan` RPC, updates `cron_health_state`, logs to `cron_health_log`; on a healthy→failing transition sends one in-app notification + email to all super-admins; on recovery sends in-app only). Health truth comes from the HTTP response layer — `cron.job_run_details` marks a 404 as "succeeded" and cannot be trusted.
  - **Platform (super-admin):** `provision-org` (atomic org creation + catalog seeding + first-admin invite, requires super-admin); `resend-invitation` (resend an existing `org_invitations` row's email); `platform-edge-metrics` (super-admin-gated proxy for the Supabase Management/Analytics API — returns per-function invocation counts, error rates, and p50/p95 latency; uses the `ANALYTICS` PAT env secret, not a service-role key; read-only).
  - **Account & data (GDPR):** `delete-my-account` (authenticated; last-admin-guarded via `sole_admin_orgs`; calls `anonymize_user` **via the caller's JWT client** then `auth.admin.deleteUser`) and `export-org-data` (super-admin; full org JSON bundle). Per-user export is the `export_my_data` RPC; org deletion is the `delete_org` RPC (super-admin); account anonymization is the `anonymize_user` RPC.
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first via `requireRole` (any-org), `requireOrgRole(org_id, [...])` (org-scoped), or `requireSuperAdmin` (platform-admin endpoints) from `_shared/auth.ts` — see `create-invitation` / `provision-org` for patterns. `requireOrgRole` automatically accepts super-admins so god-mode works on org-scoped endpoints.
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Notification system

- In-app notifications write to the `notifications` table (columns: `id`, `user_id`, `type`, `title`, `message`, `read` boolean, `related_entity_id`, `related_entity_type`, `created_at`). There is no `payload` column and no `read_at` timestamp — read state is a plain boolean `read`.
- `FEATURES.NOTIFICATIONS` must be `true` (it is, by default).
- Create notifications from edge functions or server-side mutations only — never bare client-side inserts without proper RLS policies.
- **Notification preferences** — users opt out per `category × channel` (email / in-app) in the `notification_preferences` table (JSONB `prefs` column; own-row RLS). Missing row or missing key means **enabled** (opt-out model, so existing users are unaffected on migration). Enforced at two chokepoints:
  - `gate_notification_pref` BEFORE INSERT trigger on `notifications` — calls `should_notify(user_id, type)` via `category_of(type)` → silently cancels the insert if the user has disabled that category's in-app channel.
  - Per-category gate in `send-transactional-email` — calls `get_user_id_by_email` RPC (service-role only) to resolve the recipient, then checks the preference. Critical templates (`org-invitation`, `password-reset`) and types not mapped in `category_of` are never gated.
- The shared category model (`NOTIFICATION_CATEGORIES`, `IN_APP_TYPE_CATEGORY`, `EMAIL_TEMPLATE_CATEGORY`) lives in `supabase/functions/_shared/notificationCategories.ts` and is re-exported by `src/lib/notificationCategories.ts` so the UI and the gate never diverge.

### Styling

- **Use semantic tokens only**: `bg-background`, `text-foreground`, `text-primary`, `border-border`, etc. Never hardcode colors like `bg-white` or `text-black` in components.
- **Accent numbered stops (`accent-50`–`900`) do NOT support Tailwind opacity modifiers** (`bg-accent-500/20`, `text-accent-700/60`, …) — those vars are plain hex (not HSL channels), so the `/<alpha>` silently yields a solid color with no error. For an alpha accent, use a solid stop, an `rgba()` literal, or a dedicated token.
- **Extended design-system token vocabulary** (all in `src/index.css`):
  - Neutral surface aliases: `--surface`, `--surface-2`, `--surface-3`, `--bg`, `--text`, `--text-muted`, `--text-faint`
  - Semantic tint pairs (light + dark overrides): `--green-100/500/600`, `--amber-100/500/600`, `--red-100/500/600`. Use as arbitrary values (`bg-[var(--red-100)]`) — they are not Tailwind palette names.
  - Motion / density: `--ease-out/in-out`, `--dur-fast/base/slow`, `--row-h`, `--btn-h`. CSS-only; not exposed as Tailwind utilities.
  - Overlay scrim: `--veil`; shadow ramp: `--shadow-0/4/inset`.
  - Hover/active primary shades: `--primary-hover`, `--primary-active`.
- **Tailwind utilities added** (beyond the default shadcn set): `rounded-xs`, `rounded-s/m/l/xl/2xl`, `rounded-pill`; `shadow-elev0`, `shadow-elev4`, `shadow-elev-inset`.
- **Badge semantic tint pattern** — status badges (`confirmed`, `hold`, `risk`, `destructive`) use the `-100` bg + `-600` text pair (e.g. `bg-[var(--green-100)] text-[var(--green-600)]`), not hardcoded colors.
- All design tokens live in `src/index.css` (HSL, except the hex `--accent-50`–`900` scale and the semantic tints) and `tailwind.config.ts`.
- Display font: `font-display` (Geist). Body: default Geist (`font-sans`); mono: `font-mono` (Geist Mono). Fonts are loaded in `index.html` and set in `tailwind.config.ts`.
- Match the existing component patterns: `Card` for grouped content, `Tabs` for sectioned admin UIs, `Badge` for status pills.

### TypeScript

- Prefer types derived from `Database` in `src/integrations/supabase/types.ts` — see `src/types/index.ts` for extension patterns.
- `any` is allowed for Supabase joined-row shapes when typing them is disproportionate, but isolate to the boundary.

### Testing

*Design rationale: ADR-0002 (testability foundation — edge-function DI, data-access extraction, the five layers).*

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
- Every new table needs RLS enabled and explicit policies. Default to `authenticated` role; on tenant tables restrict reads by `is_org_member(auth.uid(), org_id)` and writes by `has_org_role(auth.uid(), org_id, ...)` (the uniform org-isolation template), plus the RESTRICTIVE `org_isolation` policy (pooled multi-tenancy: ADR-0003).
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
| `src/config/app.config.ts` | FEATURES flags, ROUTES, BOOKING_ENGINE_DEFAULTS (canonical booking-engine fallbacks; mirrors `_shared/settings.ts`), SYSTEM_HEALTH / SYSTEM_HEALTH_BUDGET (platform health thresholds), CHAT_ARCHIVE_DAYS |
| `src/integrations/supabase/types.ts` | Auto-generated DB types — read only |
| `src/features/auth/AuthContext.tsx` | Auth state, org-scoped role helpers, `currentOrg`/`orgs`/`switchOrg`, `isSuperAdmin` |
| `src/features/auth/resetPassword.ts` | Pure helpers for reset-password flow (hash parse, redirect safety, schema) |
| `src/features/consent/ConsentContext.tsx` | GDPR consent state (analytics / sessionReplay / errorTracking) |
| `src/features/editor/EditorContext.tsx` | Editor mode state, page access and column/permission config (admin only) |
| `src/data/settings.ts` | `resolveOrgSetting` / `upsertOrgSetting` — org-aware settings resolver (frontend) |
| `src/data/platform.ts` | Super-admin data access: `fetchAllOrgs`, `provisionOrg`, `fetchPlatformOrgStats`, platform admin CRUD |
| `src/data/profiles.ts` | `fetchMyProfile` / `updateMyProfile` / `updateMyPassword` |
| `src/data/members.ts` | `fetchOrgMembers` / `removeOrgMember` / `setOrgMemberRole` (via `list_org_members` / `remove_org_member` / `set_org_member_role` RPCs) |
| `src/data/airtableKey.ts` | `saveAirtableKey` / `fetchAirtableKeyStatus` / `deleteAirtableKey` — Vault-backed PAT management |
| `src/data/airtableSettings.ts` | Tab-owned read of the four Airtable sync settings (org-row-wins resolution) — used by AirtableSyncTab autosave |
| `src/data/notificationPreferences.ts` | `fetchMyNotificationPreferences` / `upsertMyNotificationPreferences` |
| `src/lib/systemHealth.ts` | Pure 4-state health derivation (Operational/Degraded/Down/Stale) from p95/error-rate budgets — unit-tested |
| `src/lib/notificationCategories.ts` | Re-exports the shared category model from `_shared/notificationCategories.ts` |
| `src/hooks/` | All domain hooks — reuse before writing new queries |
| `src/types/index.ts` | Domain type extensions on top of Supabase types |
| `supabase/functions/_shared/settings.ts` | `resolveOrgSetting` + `getActiveOrgs` — org-aware settings for edge functions |
| `supabase/functions/_shared/auth.ts` | `requireRole` / `requireOrgRole` / `requireSuperAdmin` / `requireCronOrRole` |
| `supabase/functions/_shared/notificationCategories.ts` | Canonical notification category + channel model; imported by both the gate trigger helpers and `src/lib/notificationCategories.ts` |
| `supabase/functions/provision-org/index.ts` | Atomic org creation + catalog seed + first-admin invite (super-admin) |
| `supabase/functions/send-offer-digest/index.ts` | Daily offer digest (Berlin 19:00 gate) |
| `supabase/functions/send-confirmation-digest/index.ts` | Daily confirmation digest (Berlin 20:00 gate) |
| `supabase/functions/airtable-poll/index.ts` | Org-aware Airtable → show_dates sync; resolves `multipleRecordLinks` fields to names |
| `supabase/functions/open-offer-tier/index.ts` | Creates suggested bookings for a date/tier |
| `supabase/functions/close-offer-tier/index.ts` | Closes a tier; optionally cancels still-suggested bookings (withdraw=true) |
| `supabase/functions/tier-at-risk-watcher/index.ts` | In-app notification when a tier can no longer fill before deadline |
| `supabase/functions/cron-health-watcher/index.ts` | Reads HTTP outcomes from `net._http_response`; updates `cron_health_state`; alerts super-admins on failure transitions |
| `supabase/functions/platform-edge-metrics/index.ts` | Super-admin proxy for the Supabase Management/Analytics API — returns per-function latency + error metrics |
| `supabase/functions/delete-my-account/index.ts` | Authenticated account self-deletion: last-admin guard → `anonymize_user` → `auth.admin.deleteUser` |
| `src/data/account.ts` | `exportMyData` / `deleteMyAccount` / `fetchNotificationPreferences` / `upsertNotificationPreferences` |

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
