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
npm run lint         # eslint (zero-warning gate: --max-warnings 0)
npx vitest run       # unit tests (vitest + jsdom; setup in src/test/setup.ts)
npm run test:coverage # what CI runs: the same suite + the coverage thresholds
npm run test:watch   # vitest watch mode
```

**Type-checking is split across three projects** — run all three, none of them subsumes the others:

```bash
npx tsc -p tsconfig.app.json --noEmit    # src/
npx tsc -p tsconfig.tools.json --noEmit  # e2e/, scripts/*.test.ts, build configs
deno check --node-modules-dir=none supabase/functions/*/index.ts  # the edge runtime
```

CI runs `vitest run --coverage` (not a bare `vitest run`): the thresholds in `vitest.config.ts` only apply under `--coverage`, and the suite is executed exactly once — do not add a second job that re-runs it uninstrumented.

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

**Optional local dev auto-login.** To skip the login screen while running `npm run dev`, set `VITE_DEV_AUTOLOGIN=true` plus `VITE_DEV_AUTOLOGIN_EMAIL` / `VITE_DEV_AUTOLOGIN_PASSWORD` (a real account for this project's Supabase) in your gitignored `.env` — `AuthProvider` then auto-signs-in on mount so gated routes render. It's an ordinary password sign-in (RLS is unchanged) and the whole path is guarded by `import.meta.env.DEV`, so it is dead-stripped from production builds and can never run on a deployed server. Keep these vars unset in any hosting provider. See `src/features/auth/devAutoLogin.ts`.

---

## Git workflow

- **Branch naming:** `feature/<short-desc>`, `fix/<short-desc>`, `claude/<short-desc>`
- **Commit messages:** imperative, lowercase, ≤72 chars (e.g. `add artist availability calendar`)
- **Claude Code sessions** develop on the branch specified at session start (see `memory.md` for current active branch).

---

## Versioning & changelog

- **Semver tags on releases.** Tag the release commit `vMAJOR.MINOR.PATCH` (`git tag -a v1.4.0 -m "<theme>"` then `git push origin --tags`). MINOR = new user-facing features, PATCH = fixes, MAJOR = breaking changes. Tags exist through `v1.4.0` (Jun 21, 2026) — versions since then (`1.4.1`–`1.8.0`, current) shipped without tags; catch up the tagging when convenient, don't skip it going forward.
- **Bump the version in two places to match the tag:** `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` (the latter renders next to the brand name in the top-left of `AppLayout`).
- **Update `public/changelog.md`** (the single source of truth). Add a newest-first block: `## X.Y.Z — Mon D, YYYY`, a one-line `*theme*`, then `### New` / `### Improved` / `### Fixed` bullets written for end users (no refactors, tests, CI, or docs). Bullets use the form `- **Title** — description`. Never mention super-admin or platform-admin actions (Platform console, org provisioning, org-module toggles, etc.) — there is no public super-admin or platform-admin role, so those changes have no customer-facing angle and don't belong in this file at all.
- **Regenerate the JSON:** `deno run --allow-read --allow-write scripts/changelog-to-json.ts` rewrites `public/changelog.json` from the markdown — never hand-edit the JSON.
- **Both files are served publicly** at `/changelog.md` and `/changelog.json` with `Access-Control-Allow-Origin: *` (see `vercel.json`) and consumed by the standalone landing-page repo. Don't rename or move them without updating the landing page.
- **The dependency runs both ways.** `CHANGELOG_URL` in `src/config/app.config.ts` points the in-app version pill at the landing page's `/changelog` route. Nothing in this repo can typecheck or test that route, so renaming it there silently 404s the pill — change it in both repos together.

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
                   #   OrgMembersPopover, SystemHealthTab) + pure utilities (platformFormat.ts,
                   #   templateText.ts) + systemHealth/ (OverallStatusBanner, DomainSummaryGrid,
                   #   EdgeFunctionsPanel, ScheduledJobsPanel, UptimeBar, RecentRunsList,
                   #   primitives)
    catalog/       # Production catalog CRUD: ShowFormDialog (create/edit shows) + ProductionsPage support
    shows/         # ShowDateDetailSheet — the full per-date booking management surface;
                   #   ShowDateFormDialog — create/edit show_dates (in-app);
                   #   hireOrders/ (HireOrdersCard + GenerateHireOrderDialog: the per-date
                   #   hire-order surface embedded in ShowDateDetailSheet, feature-gated)
    hireOrders/    # Shared hire-order document primitives (OrderFactsRail, OrderTimeline)
                   #   used by the HireOrderDetailPage viewer
    settings/      # AirtableSyncTab (schema-driven mapping + catalog linking), OrganizationTab,
                   #   CastsCitiesTab, ProductionOwnershipTab, DocumentationTab (+ MarkdownDoc,
                   #   SystemMapCanvas, SystemMapReference — Settings → Documentation → System Map),
                   #   hireOrders/HireOrdersTab (Letterhead, Numbering, OrderDefaults,
                   #   TermsVariants, Countersign cards; Settings > Hire orders, admin-only)
                   #   + hireOrders/template/ (the PDF template WYSIWYG editor at
                   #   ROUTES.HIRE_ORDER_TEMPLATE: outline / live browser-rendered PDF /
                   #   inspector panes over the semantic role registry in
                   #   src/lib/hireOrders/pdf/pdfTheme.ts)
    layout/        # AppLayout (sidebar + topbar shell), NotificationsList (notification bell popover)
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # ROUTE_FEATURES (entitlement-gated routes), route constants (ROUTES), BOOKING_ENGINE_DEFAULTS, CHAT_ARCHIVE_DAYS
  data/            # Data-access layer: fetchX(client, args) / mutateX(client, args) functions
                   #   that take the Supabase client as a parameter. Hooks are thin wrappers.
                   #   Domains: account, admin, artistImport, artists, airtableKey, airtableMapping,
                   #   airtableSchema, airtableSettings, airtableSync, bookings, cities, customFields,
                   #   entitlements, hireOrders, invitations, members, notificationPreferences,
                   #   notifications, orgs, platform, profiles, remoteSheet, settings, shows, showDates,
                   #   skills, systemMap.
                   #   Test with supabaseFake.ts (never vi.mock the client).
  features/
    auth/          # AuthContext (org-aware: currentOrg/orgs/switchOrg, isSuperAdmin),
                   #   realtimeInvalidations.ts (REALTIME_INVALIDATIONS table→query-key map),
                   #   ProtectedRoute (org gate → NoOrgScreen / SuspendedOrgScreen;
                   #   super-admins bypass org gate and suspended-org check),
                   #   PlatformRoute (super-admin-only gate for /platform, no org required),
                   #   orgRoles.ts (multi-org role utilities),
                   #   resetPassword.ts (pure hash-parse / redirect-safety / schema helpers)
    consent/       # ConsentContext, ConsentProvider, useConsent hook — localStorage-backed GDPR consent state
                   #   (key: showflow.consent.v1; categories: analytics, sessionReplay, errorTracking)
                   #   ConsentProvider wraps the routing tree (inside BrowserRouter, outside AuthProvider/EditorProvider).
    editor/        # Admin-only UI editor: EditorContext, EditorToolbar, EditorSidePanel,
                   #   ColumnLayoutEditor, columnRegistries, types,
                   #   editorAccess.ts (canUseEditor — the org-admin-or-super-admin gate
                   #   shared by the provider, toolbar, toggle and AppLayout).
                   #   Persists page access / column templates / table permissions in
                   #   app_settings (keys: editor_page_access, editor_column_templates,
                   #   editor_table_permissions). EditorProvider wraps the whole app.
                   #   Read-only hook for page components: useEditorConfig().
  hooks/           # Domain hooks (useMyArtist, useEligibleArtists, useChatParticipant,
                   #   useArtistEligibleDates, useSettingsWarnings,
                   #   useSkills/useArtistSkills, useNotifications/useMarkNotificationRead/
                   #   useMarkAllNotificationsRead, useNotificationPreferences,
                   #   useMyProfile/useUpdateMyProfile,
                   #   useOrgMembers/useRemoveOrgMember/useSetOrgMemberRole,
                   #   usePendingInvitedArtists, useNavCounts (sidebar badge counts),
                   #   useSystemHealth, useShows/useShowDates/useCities/useAllCities)
                   #   + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  lib/             # Shared utilities: utils.ts (cn helper), dates.ts (parseDateOnly,
                   #   formatDateDMY, formatDateWithWeekday, toDateKey — all timezone-safe),
                   #   avatar.ts, bookings.ts, catalog.ts (isSyncedShow/Date, canHardDeleteShow/Date),
                   #   settings.ts (dedupeProgramPairs, effectiveSlots), singleFlight.ts,
                   #   hireOrders/kpis.ts (computeOrderKpis)
  pages/           # One file per route, default-exported
                   #   Key pages: DashboardPage, ShowsBookingsPage (ROUTES.BOOKINGS),
                   #   ProductionsPage (ROUTES.PRODUCTIONS) — admin+producer catalog CRUD + drag-reorder,
                   #   ArtistsPage (admin+producer), AvailabilityPage (artist),
                   #   AdminPage, SettingsPage, ChatsListPage
                   #   ProfilePage (ROUTES.PROFILE) — user profile + in-app password change
                   #   ResetPasswordPage (ROUTES.RESET_PASSWORD) — request + set (public, no auth)
                   #   PlatformPage (ROUTES.PLATFORM) — super-admin console; uses PlatformRoute
                   #   HireOrderDetailPage (ROUTES.HIRE_ORDER_DETAIL, /hire-orders/:id): the
                   #     single hire-order viewer (admin/producer/artist; feature-gated route)
                   #   Public pages (no auth): UnsubscribePage, PrivacyPage, ImpressumPage,
                   #   AcceptInvitePage, ResetPasswordPage
                   #   /signup redirects to /login (no standalone signup page).
  types/           # Domain types extending Supabase row types
docs/
  app-logic.md    # Domain guide (roles, data model, booking flow) — for admins/producers
  system-map.md   # Automation engine map (trigger→function→data→effect) — mirrored by src/data/systemMap.ts (in-app canvas); update both in the same PR as any automation change
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
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email; accepts an optional `artist_id` to deterministically link a catalog artist — validates same-org + `user_id IS NULL` and forces role `artist`). Acceptance is the `accept_invitation` RPC (links the artist by `org_invitations.artist_id` first — guarded so it no-ops when the caller already owns an org artist — else by lowercased email), not an edge function. `org_invitations.artist_id` is an FK → `artists(id) ON DELETE SET NULL`, also read by the `list_pending_invited_artists(p_org)` RPC that feeds the artist-card account-status chip.
  - **Airtable sync:** `airtable-schema` (admin-only, user-JWT via `requireOrgRole(org_id, ['admin'])`) reads the org's Airtable schema with the Vault PAT for the mapping UI — returns `{ schemaAccessible, bases }` (no `baseId` in body) or `{ schemaAccessible, tables }` (with `baseId`); an Airtable `403` (PAT missing the `schema.bases:read` scope) surfaces as `{ schemaAccessible: false }` so the UI falls back to typed inputs, and the PAT is never returned to the client. `airtable-poll` is the `*/5 * * * *` cron that upserts `show_dates` from each org's base (each org is throttled by its `airtable_poll_interval_minutes` setting, min 5; an org-admin "Sync now" triggers a single-org poll on demand) (see the Airtable-sync key decision in `docs/adr/README.md`).
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Booking engine:** `open-offer-tier` (create suggested bookings) and `close-offer-tier` (close a tier ± withdraw its pending offers) are per-request endpoints taking a `show_date_id`, not crons. The cron functions — `expire-offers` (hourly expiry), `send-offer-digest` (daily 19:00 Berlin), `send-confirmation-digest` (daily 20:00 Berlin) — are org-aware: they iterate active orgs via `getActiveOrgs(admin)` from `_shared/settings.ts` and resolve settings per-org with `resolveOrgSetting`.
  - **Watchers:** `tier-at-risk-watcher` — scans open offer tiers and fires an in-app `tier_at_risk` notification when remaining pending + accepted < required slots. Idempotent (one notification per date/tier). No email; visual only. `cron-health-watcher` — 15-min cron that classifies every cron job healthy/failing/stale from the dispatch-capture tables and alerts super-admins on failure transitions. `health-rollup` — 15-min cron that recomputes **today's and yesterday's** per-function run/failure counts from the Analytics API into `health_daily`, the durable source behind the System Health 30-day uptime bar (Analytics itself retains only 24h, so nothing older can be reconstructed and nothing can be backfilled). Recomputes whole days rather than incrementing, so it is idempotent under a double-fire or retry, and aborts without writing when Analytics is unavailable so an outage cannot punch a permanent hole in the bar.
  - **Platform (super-admin):** `provision-org` (atomic org creation + catalog seeding + first-admin invite, requires super-admin); `resend-invitation` (resend an existing `org_invitations` row's email); `platform-edge-metrics` (System Health metrics proxy to the Supabase Analytics API via the dedicated `ANALYTICS` PAT).
  - **Account & data (GDPR):** `delete-my-account` (authenticated; last-admin-guarded via `sole_admin_orgs`; calls `anonymize_user` **via the caller's JWT client** then `auth.admin.deleteUser`) and `export-org-data` (super-admin; full org JSON bundle). Per-user export is the `export_my_data` RPC; org deletion is the `delete_org` RPC (super-admin); account anonymization is the `anonymize_user` RPC.
  - **Import:** `fetch-remote-sheet` — SSRF-guarded proxy that fetches a public Google Sheets CSV for the bulk artist import (`requireOrgRole(org_id, ['producer','admin'])`; host-allowlisted to `docs.google.com` published-CSV URLs, no redirect following, size/timeout caps). The bulk insert itself is the `bulk_import_artists(p_org, p_rows)` RPC — a producer/admin-guarded `SECURITY DEFINER` set-based insert with server-side dedup on `lower(email)`, returning a per-row jsonb status array. Client parse/map/dedup lives in the pure `src/lib/artistImport/*` modules behind the `ArtistImportDialog` wizard.
  - **Hire orders:** `generate-hire-orders` is the hire-order engine: one endpoint, four per-request actions. `draft` creates draft orders from a date's confirmed bookings (snapshotting fields via `resolveFields`); `issue` readiness-gates, renders the PDF, uploads it to the `hire-orders` bucket, stamps `issued`, emails the artist the PDF attachment and notifies them; `preview` returns a watermarked PDF and persists nothing; `download-url` returns a signed URL for producers, super-admins, or the linked artist on issued/countersigned orders. It runs `verify_jwt = false` in `config.toml` because the auto-draft DB trigger calls it with `X-Cron-Secret`, so it self-authorizes via `requireCronOrRole(['admin','producer'])` for cron callers or `requireOrgRole(org_id, ['admin','producer'])` for JWT callers, then `requireFeature(org, 'hire_orders')`. `download-url` runs its own per-order auth ahead of that gate. When a show_date transitions into `fully_filled`, the feature-gated `dispatch_hire_order_drafts` DB trigger fires the `draft` action so orders are auto-drafted; issuing stays a human action in the UI. Frontend data access is `src/data/hireOrders.ts` with thin hooks in `src/hooks/useHireOrders.ts`. Ships DARK (the `hire_orders` entitlement defaults off).
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first via `requireRole` (any-org), `requireOrgRole(org_id, [...])` (org-scoped), or `requireSuperAdmin` (platform-admin endpoints) from `_shared/auth.ts` — see `create-invitation` / `provision-org` for patterns. `requireOrgRole` automatically accepts super-admins so god-mode works on org-scoped endpoints.
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Notification system

- In-app notifications write to the `notifications` table (columns: `id`, `user_id`, `type`, `title`, `message`, `read` boolean, `related_entity_id`, `related_entity_type`, `created_at`). There is no `payload` column and no `read_at` timestamp — read state is a plain boolean `read`.
- Create notifications from edge functions or server-side mutations only — never bare client-side inserts without proper RLS policies.

### Styling

- **Use semantic tokens only**: `bg-background`, `text-foreground`, `text-primary`, `border-border`, etc. Never hardcode colors like `bg-white` or `text-black` in components.
- **Accent numbered stops (`accent-50`–`900`) do NOT support Tailwind opacity modifiers** (`bg-accent-500/20`, `text-accent-700/60`, …) — those vars are plain hex, not HSL channels, so the `/<alpha>` silently yields a solid color with no error. For an alpha accent, use a solid stop, an `rgba()` literal, or a dedicated token.
- All design tokens live in `src/index.css` (HSL, except the hex `--accent-50`–`900` scale) and `tailwind.config.ts`.
- Display font: `font-display` (Geist). Body: default Geist (`font-sans`); mono: `font-mono` (Geist Mono). Fonts are loaded in `index.html` and set in `tailwind.config.ts`.
- Match the existing component patterns: `Card` for grouped content, `Tabs` for sectioned admin UIs, `Badge` for status pills.

### TypeScript

- Prefer types derived from `Database` in `src/integrations/supabase/types.ts` — see `src/types/index.ts` for extension patterns.
- `any` is banned (lint error, CI-gated via `--max-warnings 0`). When supabase-js can't infer a joined-row
  shape, define an explicit local row `interface` and cast once at the query result
  (`as unknown as Row[]`) immediately after the error check — confined to `src/data/**`,
  hook `queryFn`s, and `supabase/functions/**`. Never deep-access an untyped row.
  Test stubs go through the typed helpers (`src/test/castHelpers.ts` — `asSupabase`/`asQueryResult`/`partialMock`;
  `supabase/functions/_shared/testing.ts` — `asTypedClient`/`bindFakeFrom`/`setFakeFrom`) —
  one cast inside the helper, never per-site `as any`.

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
- **Nullable RPC arguments have no home in the generated types.** PostgREST type-gen marks every function arg non-null and cannot express `CALLED ON NULL INPUT`, so an RPC that legitimately takes NULL still generates `p_foo: string`. Do not widen it in `types.ts` — that quietly makes the file un-regenerable and the next `supabase gen types` breaks the build. Declare a widened args type in `supabase/functions/_shared/rows.ts` (see `ResolveShowAssignmentsArgs`, `CreateHireOrderWithDatesArgs`) and cast at the `.rpc()` call. `scripts/generatedTypes.test.ts` guards this.
- **Regenerating the types:** `supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`, then `npm run sync:mirrors` for the edge mirror. Verify with `npm run sync:mirrors:check`, `npx tsc -p tsconfig.app.json --noEmit`, and `deno check --node-modules-dir=none` on any edge function you touched — the edge runtime is not covered by `tsc`.
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
| `src/config/app.config.ts` | ROUTE_FEATURES (entitlement-gated routes), ROUTES, BOOKING_ENGINE_DEFAULTS (canonical booking-engine fallbacks; mirrors `_shared/settings.ts`), CHAT_ARCHIVE_DAYS |
| `scripts/sync-mirrors.mjs` | Generator for every dual-homed frontend/edge file. **`scripts/mirrors.manifest.json` is the source of truth for what is mirrored — read it rather than any list in this file.** Two modes: `file` (whole file, stamped with a `// GENERATED FILE. Do not edit.` header, optionally prefixed by a `prelude` for per-runtime directives the source must not carry — e.g. the edge `render.tsx` JSX pragma) and `block` (sentinel-delimited region, e.g. the registries in `src/lib/capabilities.ts` / `src/lib/entitlements.ts`). `npm run sync:mirrors` regenerates every target from its source; `npm run sync:mirrors:check` fails CI on drift. **Never hand-edit a generated target or block** — if a file opens with the GENERATED stamp, edit its `source` and regenerate. Two dual-homed pairs are deliberately NOT in the manifest and stay hand-maintained: `src/lib/hireOrders/types.ts` (structural, five files combined into one) and the hire-order consent text (`SignHireOrderDialog.tsx` / `generate-hire-orders/index.ts`) |
| `src/lib/entitlements.ts` | Per-org module entitlements registry: `FeatureKey`, `FEATURE_REGISTRY`, `enabledFeatures`/`isFeatureEnabled`. This is the SOURCE for the sentinel-delimited block in `supabase/functions/_shared/entitlements.ts` (the two runtimes can't share an import): edit here, then run `npm run sync:mirrors` to regenerate the block, never hand-edit it in the target. The SQL twin `public.is_feature_enabled()` is not covered by the generator, so keep it in sync by hand in the same commit |
| `src/lib/capabilities.ts` | Per-org **capabilities** ("user group rights") registry: `CAPABILITY_DEFS` (role x action grants), `resolveCapability` (lock → org override → platform default → registry default), group helpers. Distinct from entitlements: a module says a feature *exists*, a capability says who may *use* it. The sentinel-delimited registry block is the SOURCE for the same block in `supabase/functions/_shared/capabilities.ts`: edit here, then run `npm run sync:mirrors` to regenerate it, never hand-edit it in the target. `public.capability_default()` is the SQL twin (guarded by `capabilityDefaultsSql.test.ts`) and is not covered by the generator, so keep it in sync by hand. UI reads it via `useCan(action)` (`src/hooks/useCapabilities.ts`) |
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
| `supabase/functions/_shared/database.types.ts` | Generated from `src/integrations/supabase/types.ts` by `npm run sync:mirrors` (`scripts/mirrors.manifest.json`); `npm run sync:mirrors:check` enforces it in CI. Never hand-edit; regenerate after `types.ts` changes |
| `supabase/functions/_shared/auth.ts` | `requireRole` / `requireOrgRole` / `requireSuperAdmin` / `requireCronOrRole` |
| `supabase/functions/provision-org/index.ts` | Atomic org creation + catalog seed + first-admin invite (super-admin) |
| `supabase/functions/send-offer-digest/index.ts` | Daily offer digest (Berlin 19:00 gate) |
| `supabase/functions/send-confirmation-digest/index.ts` | Daily confirmation digest (Berlin 20:00 gate) |
| `supabase/functions/airtable-poll/index.ts` | Org-aware Airtable → show_dates sync (per-org Vault key) |
| `supabase/functions/open-offer-tier/index.ts` | Creates suggested bookings for a date/tier |
| `supabase/functions/tier-at-risk-watcher/index.ts` | In-app notification when a tier can no longer fill before deadline |
| `supabase/functions/delete-my-account/index.ts` | Authenticated account self-deletion: last-admin guard → `anonymize_user` → `auth.admin.deleteUser` |
| `src/data/account.ts` | `exportMyData` / `deleteMyAccount` |
| `src/data/notificationPreferences.ts` | `fetchMyNotificationPreferences` / `updateMyNotificationPreferences` |
| `docs/system-map.md` | Automation engine system map: every trigger → function → data → side effect, with the DB guards. Mirrored by `src/data/systemMap.ts` (the in-app Settings → Documentation → System Map canvas); update both in the same PR as any automation change |

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
- Casting Supabase rows or clients with `as any` — use an explicit row interface + single `as unknown as` cast at the query boundary, or the typed test helpers (`castHelpers.ts` / `_shared/testing.ts`).
