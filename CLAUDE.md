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

## Architecture

```
src/
  components/
    admin/         # Admin-only UI (InvitesTab — org invite management, etc.)
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
    shows/         # ShowDateDetailSheet — the full per-date booking management surface
    layout/        # AppLayout (sidebar + topbar shell), NotificationsList (notification bell popover)
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # Feature flags (FEATURES), route constants (ROUTES), BOOKING_CONFIG, CHAT_ARCHIVE_DAYS
  features/
    auth/          # AuthContext (org-aware: currentOrg/orgs/switchOrg), ProtectedRoute
                   #   (org gate → NoOrgScreen / SuspendedOrgScreen), orgRoles helper
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
                   #   useArtistEligibleDates, useSubProgramSlots, useSettingsWarnings,
                   #   useSkills/useArtistSkills, useNotifications/useMarkNotificationRead/
                   #   useMarkAllNotificationsRead) + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  lib/             # Shared utilities: utils.ts (cn helper), dates.ts (parseDateOnly,
                   #   formatDateDMY, formatDateWithWeekday, toDateKey — all timezone-safe),
                   #   avatar.ts
  pages/           # One file per route, default-exported
                   #   Key pages: DashboardPage, ShowsBookingsPage (ROUTES.BOOKINGS),
                   #   ArtistsPage (admin+producer), AvailabilityPage (artist),
                   #   AdminPage, SettingsPage, ChatsListPage
                   #   Public pages (no auth): UnsubscribePage, PrivacyPage, ImpressumPage
                   #   ROUTES.PROFILE and ROUTES.RESET_PASSWORD are defined but have
                   #   no pages yet — reserved for future implementation.
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

- **Single source of truth for routes/flags:** `src/config/app.config.ts`. Reference `ROUTES.X` rather than string literals. `CHAT_ARCHIVE_DAYS` (30) hides chats from the list and gates write access after a show date passes (chats older than 30 days are hidden from `ChatsListPage` for non-admins and made read-only in `ChatPanel`). Note: `ROUTES.SHOWS` (`/shows`) has been removed — the `/shows` path no longer exists.
- **Admin-tunable settings live in the DB:** the `app_settings` table (key/value JSONB) is edited via the Settings page. Static developer-only constants stay in `app.config.ts`.
- **Onboarding is invite-only.** There is no public signup and no approval queue. An org admin invites a person by email via the `create-invitation` edge function (inserts `org_invitations` + sends the `org-invitation` email with an `/accept-invite?token=` link); the invitee accepts via the `accept_invitation` SECURITY DEFINER RPC, which writes their `org_memberships` row. `ProtectedRoute` gates on membership: no active org → `NoOrgScreen`; suspended org → `SuspendedOrgScreen`. (The old `user_approvals` / `ApprovalGate` / `admin-decide-approval` flow was retired.)
- **Role checks are always server-enforced via RLS.** The client `useAuth().hasRole(...)` is for UX only (hiding nav, gating pages); never trust it for data access.
- **Roles live in `org_memberships`** (per-org: `(org_id, user_id, role)`), never on `profiles`. Check via the `has_org_role(uuid, org_id, app_role)` / `is_org_member(uuid, org_id)` security-definer functions in policies (both short-circuit on `is_super_admin`). The old global `user_roles` table + `has_role()` were dropped. `AuthContext` derives the active org's roles, so `useAuth().hasRole()` keeps its signature.
- **Chat is per show-date.** One `chats` row per `show_date_id`; participation is gated by `is_chat_participant(chat_id, user_id)` (admins, producers, and artists booked/soft-booked for that date). After `CHAT_ARCHIVE_DAYS` days, chats are hidden from `ChatsListPage` for non-admins and become read-only in `ChatPanel` (admins can still view the archived thread).
- **Artist availability is gated by eligibility.** Artists can only declare availability on dates returned by `useArtistEligibleDates` (derived from cast eligibility). Non-eligible dates render non-interactively in the calendar.
- **`show_dates.status` is DB-computed.** A Postgres trigger (`sync_show_date_status_trigger` on `bookings`) automatically sets status to `open | partially_filled | fully_filled` based on confirmed booking counts vs the `main_cast` + `understudies` thresholds in `app_settings.sub_program_slots_defaults` (keyed by `(program, sub_program)`). Only `cancelled` is set by mutations directly. Do not set status manually in client code. A second trigger on `app_settings` recomputes all show_dates when slot defaults change; a third on `shows` does so when a show's `program` or `sub_program` is updated.
- **Slot capacity comes from settings, not columns.** There is no `slots_per_date` column on `shows` or `show_dates`. Capacity for any date is `app_settings.sub_program_slots_defaults[program][sub_program]` (an object with `main_cast` and `understudies`). When a `(program, sub_program)` combination is unconfigured, the trigger leaves status as `open`/`partially_filled` (never `fully_filled`); the UI overrides the badge to "Unconfigured" via `useSubProgramSlots` + `effectiveSlots(defaults, program, subProgram)`.
- **No UI for creating show dates.** The create-show-date flow was intentionally removed. New show_dates must be inserted via the Supabase dashboard or a future admin-only flow.
- **Booking detail surface: `ShowDateDetailSheet`.** The full booking management experience (date config, assigned artists, available artists, chat) lives in `src/components/shows/ShowDateDetailSheet.tsx`. There is no standalone `/shows/:id` page — `ShowDetailPage` and `ShowDetailSheet` have been deleted.
- **Audit trail:** all booking status changes append to `booking_audit_log`. Never delete from this table.
- **Airtable sync is implemented.** The `airtable-poll` edge function upserts `show_dates` from Airtable and is scheduled via pg_cron (`*/5 * * * *`). Enable it by setting `airtable_sync_enabled = true` in app_settings (via Settings → Airtable) and configuring `airtable_base_id`, `airtable_table_name`, and the `AIRTABLE_API_KEY` edge function secret.
- **Feature flags** live in `app.config.ts` as the `FEATURES` object. Check with `if (FEATURES.FEATURE_NAME) { ... }`. Wrap entire feature blocks, not individual lines. Don't build UI for a flag that's `false` unless wiring it up in the same change.
- **Admin-only editor mode:** `EditorProvider` (wraps the entire app in `App.tsx`) exposes `isEditorMode`. Admins in editor mode bypass route-level role gates — `ProtectedRoute` reads `pageAccess` from `useEditorConfig()` and uses DB-stored role overrides instead of the `requiredRoles` prop. Never use `isEditorMode` to skip server-side RLS checks.
- **GDPR consent system:** `ConsentProvider` wraps the routing tree in App.tsx (inside BrowserRouter, outside AuthProvider/EditorProvider). `CookieConsentBanner` is rendered globally inside `ConsentProvider`; it is visible when `!hasDecided` and while the preferences dialog is closed (`!preferencesOpen`). Consent choices (analytics, sessionReplay, errorTracking) are persisted in `localStorage` under `showflow.consent.v1`. Read choices via `useConsent()`. Only wire analytics/session-replay/error-tracking SDKs based on the returned flags — never call them unconditionally.
- **Public routes:** `ROUTES.PRIVACY` (`/privacy`), `ROUTES.IMPRESSUM` (`/impressum`), and `ROUTES.UNSUBSCRIBE` (`/unsubscribe`) are rendered outside `ProtectedRoute` — no auth required. The legal docs are loaded from `docs/legal/*.md` via Vite `?raw` imports and rendered with `ReactMarkdown` + `remarkGfm`.

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
- Prefer the existing domain hooks in `src/hooks/` (`useMyArtist`, `useEligibleArtists`, `useArtistEligibleDates`, `useChatParticipant`, `useSubProgramSlots`, `useSettingsWarnings`, `useSkills`/`useArtistSkills`, `useNotifications`) over duplicating Supabase queries inline.
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
  - **Admin ops:** `admin-list-users`, `admin-set-role` (both org-scoped via `?org_id` / body `org_id`).
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email). Acceptance is the `accept_invitation` RPC, not an edge function.
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Booking engine:** `open-offer-tier` (create suggested bookings), `expire-offers` (hourly expiry), `send-offer-digest` (daily 19:00 Berlin), `send-confirmation-digest` (daily 20:00 Berlin).
  - **Watchers:** `tier-at-risk-watcher` — scans open offer tiers and fires an in-app `tier_at_risk` notification when remaining pending + accepted < required slots. Idempotent (one notification per date/tier). No email; visual only.
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first via `requireRole` (any-org) or `requireOrgRole(org_id, [...])` (org-scoped) from `_shared/auth.ts` — see `admin-set-role` / `create-invitation` for the pattern.
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

**Backend pattern — dependency injection:** Each edge function exports `handle(req, deps)` and only wires `Deno.serve((req) => handle(req, realDeps()))` at the bottom. `Deps` (in `supabase/functions/_shared/deps.ts`) carries the Supabase clients, `env`, `now`, `invokeFunction`/`sendEmail`, and `fetch`. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`. Use the shared `_shared/http.ts` (CORS + json) and `_shared/auth.ts` (requireRole / requireCronOrRole / isServiceRole) helpers — do not re-inline CORS, client creation, or auth.

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

Onboarding is invite-only, so there is no public signup. Bootstrap the first org admin out-of-band: create the auth user (Supabase dashboard), then insert an `org_memberships` row for the bootstrap org (`00000000-0000-0000-0000-00000000b007`) with role `admin` (Supabase SQL editor, or the `admin-set-role` function). That admin then invites producers/artists from **Admin → Invites**; each invitee accepts via the emailed `/accept-invite?token=` link. There is no automated seeding function.

Suggested emails:
- `test-admin@showflowpro.com`
- `test-producer@showflowpro.com`
- `test-artist@showflowpro.com`

**Rotate or remove before any production deploy.**

---

## Key files to reference

| File | Purpose |
|------|---------|
| `src/config/app.config.ts` | FEATURES flags, ROUTES, BOOKING_CONFIG (`SOFT_BOOK_EXPIRY_HOURS`), SYNC_CONFIG, CHAT_ARCHIVE_DAYS |
| `src/integrations/supabase/types.ts` | Auto-generated DB types — read only |
| `src/features/auth/AuthContext.tsx` | Auth state, org-scoped role helpers, `currentOrg`/`orgs`/`switchOrg` |
| `src/features/consent/ConsentContext.tsx` | GDPR consent state (analytics / sessionReplay / errorTracking) |
| `src/features/editor/EditorContext.tsx` | Editor mode state, page access and column/permission config (admin only) |
| `src/hooks/` | All domain hooks — reuse before writing new queries |
| `src/types/index.ts` | Domain type extensions on top of Supabase types |
| `supabase/functions/send-offer-digest/index.ts` | Daily offer digest (Berlin 19:00 gate) |
| `supabase/functions/send-confirmation-digest/index.ts` | Daily confirmation digest (Berlin 20:00 gate) |
| `supabase/functions/airtable-poll/index.ts` | Airtable → show_dates sync |
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
