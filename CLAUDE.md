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
    admin/         # Admin-only UI (ApprovalsTab, etc.)
    availability/  # ArtistAvailabilityCalendar, AvailabilityPicker
    bookings/      # ArtistBookingsView and booking surfaces
    calendar/      # EntityCalendar (shared month grid)
    casts/         # Cast grouping UI (dialog, sheet, section)
    chat/          # ChatPanel, MessageBubble (per-show-date threads)
    dashboard/     # Role-specific dashboards (ArtistDashboard, …)
    filters/       # Reusable filter/sort/view-toggle controls
    shows/         # ShowDetailSheet and show-related surfaces
    layout/        # AppLayout (sidebar + topbar shell)
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # Feature flags, route constants, booking weights, chat archive window
  features/
    auth/          # AuthContext, ProtectedRoute, ApprovalGate, role helpers
  hooks/           # Domain hooks (useMyArtist, useEligibleArtists, useChatParticipant,
                   #   useArtistEligibleDates) + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  pages/           # One file per route, default-exported
  types/           # Domain types extending Supabase row types
supabase/
  functions/       # Deno edge functions
    _shared/transactional-email-templates/  # React Email templates + registry
  migrations/      # SQL migrations — read-only, generated via the migration tool
```

### Key decisions

- **Single source of truth for routes/flags:** `src/config/app.config.ts`. Reference `ROUTES.X` rather than string literals. `CHAT_ARCHIVE_DAYS` (30) gates chat write access after a show date passes.
- **Admin-tunable settings live in the DB:** the `app_settings` table (key/value JSONB) is edited via the Settings page. Static developer-only constants stay in `app.config.ts`.
- **Signup is admin-gated.** New users land in `user_approvals` with status `pending`; `ApprovalGate` (inside `ProtectedRoute`) renders `PendingApprovalScreen` / `RejectedScreen` until an admin decides via the `admin-decide-approval` edge function. Role is assigned at approval time and inserted into `user_roles`.
- **Role checks are always server-enforced via RLS.** The client `useAuth().hasRole(...)` is for UX only (hiding nav, gating pages); never trust it for data access.
- **Roles live in `user_roles`**, never on `profiles`. Always check via the `has_role(uuid, app_role)` security-definer function in policies.
- **Chat is per show-date.** One `chats` row per `show_date_id`; participation is gated by `is_chat_participant(chat_id, user_id)` (admins, producers, and artists booked/soft-booked for that date). Threads become read-only after `CHAT_ARCHIVE_DAYS`; admins can still view archived threads.
- **Artist availability is gated by eligibility.** Artists can only declare availability on dates returned by `useArtistEligibleDates` (derived from cast eligibility). Non-eligible dates render non-interactively in the calendar.
- **Audit trail:** all booking status changes append to `booking_audit_log`. Never delete from this table.
- **Airtable sync is mocked.** The polling loop is not wired up; the Settings page toggles a flag the sync worker will read once implemented.
- **Feature flags** live in `app.config.ts` as the `FLAGS` object. Check with `if (FLAGS.FEATURE_NAME) { ... }`. Wrap entire feature blocks, not individual lines. Don't build UI for a flag that's `false` unless wiring it up in the same change.

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
- **Future work:** Supabase Realtime subscriptions (table-level) are the path to cross-user reactivity (e.g. Producer A's screen updates when Producer B confirms a booking). This requires enabling realtime on tables + RLS policies for realtime. Planned for a future dedicated PR.
- Prefer the existing domain hooks in `src/hooks/` (`useMyArtist`, `useEligibleArtists`, `useArtistEligibleDates`, `useChatParticipant`) over duplicating Supabase queries inline.
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
3. Register in `src/App.tsx` with `<ProtectedRoute roles={[...]}>`.
4. Add a nav item in `src/components/layout/` with matching role gating.

### Edge functions

- One folder per function under `supabase/functions/<name>/index.ts`. Current categories:
  - **Admin ops:** `admin-list-users`, `admin-set-role`, `admin-decide-approval`
  - **Signup notifications:** `notify-signup`
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first (see `admin-decide-approval` for the pattern).
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Notification system

- In-app notifications write to the `notifications` table (columns: `user_id`, `type`, `payload`, `read_at`).
- `FLAGS.NOTIFICATIONS` must be `true` (it is, by default).
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

- Framework: Vitest + jsdom + @testing-library/react. Setup in `src/test/setup.ts`.
- Co-locate tests beside the file they test: `Foo.test.tsx` next to `Foo.tsx`.
- Unit-test pure functions and hooks; mock the Supabase client via `vi.mock('../../integrations/supabase/client')`.
- Component tests: render + simulate user interaction + assert on accessible queries (`getByRole`, `getByText`).
- Never test implementation details (internal state, private methods).

### Database changes

- Schema changes go through the migration tool — never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Every new table needs RLS enabled and explicit policies. Default to `authenticated` role; restrict writes by `has_role(...)`.
- Use the `update_updated_at_column()` trigger on tables with `updated_at`.

---

## Booking workflow (domain rules)

A booking moves through: `suggested → soft_booked → confirmed` (or `cancelled` from any state).

- Soft-bookings auto-expire after `app_settings.soft_book_expiry_hours` (default 48h).
- A show date has `slots_per_date` slots; once filled, status becomes `fully_filled`.
- Understudies (`is_understudy = true`) auto-promote when the primary cancels.
- Auto-suggest scoring weights are in `BOOKING_CONFIG.SUGGEST_WEIGHTS` and must sum to 1.

---

## Test accounts (development only)

Test accounts are created manually through the standard signup flow and then approved via the admin panel. There is no automated seeding function — you must create and approve accounts yourself in the dev environment.

Suggested emails:
- `test-admin@showflowpro.com`
- `test-producer@showflowpro.com`
- `test-artist@showflowpro.com`

**Rotate or remove before any production deploy.**

---

## Key files to reference

| File | Purpose |
|------|---------|
| `src/config/app.config.ts` | Feature flags, ROUTES, BOOKING_CONFIG, CHAT_ARCHIVE_DAYS |
| `src/integrations/supabase/types.ts` | Auto-generated DB types — read only |
| `src/features/auth/AuthContext.tsx` | Auth state, role helpers, approval status |
| `src/hooks/` | All domain hooks — reuse before writing new queries |
| `src/types/index.ts` | Domain type extensions on top of Supabase types |

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
- Pushing to `main` directly — always PR through `dev`.
