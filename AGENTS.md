# AGENTS.md — Showflow Pro

Guidance for AI coding agents and new developers working on this repo. Read this first.

> Do **not** put secrets, API keys, sprint goals, or current task lists here. This file is loaded into agent context and rots quickly when filled with transient info.

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
npm run dev          # local dev server (Vite)
npm run build        # production build
npm run lint         # eslint
npx vitest run       # unit tests (vitest + jsdom; setup in src/test/setup.ts)
```

Edge functions deploy automatically when files in `supabase/functions/<name>/` change. No manual deploy step.

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
- Keep query keys stable arrays. Examples in use: `['shows']`, `['show', id]`, `['admin-users']`, `['my-artist']`, `['availability', artistId]`, `['eligible-artists', showDateId]`, `['chat', showDateId]`, `['chat-messages', chatId]`.
- Prefer the existing domain hooks in `src/hooks/` (`useMyArtist`, `useEligibleArtists`, `useArtistEligibleDates`, `useChatParticipant`) over duplicating Supabase queries inline.
- Never call Supabase from a component effect when a query will do.
- Side effects on success → `sonner` toast (`toast.success`, `toast.error`).

### Edge functions

- One folder per function under `supabase/functions/<name>/index.ts`. Current categories:
  - **Admin ops:** `admin-list-users`, `admin-set-role`, `admin-decide-approval`
  - **Signup notifications:** `notify-signup`
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Dev only:** `seed-test-data`
- Use the service role key only when bypassing RLS is intentional (admin endpoints, seeding). Always re-verify the caller's role server-side first (see `admin-decide-approval` for the pattern).
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Styling

- **Use semantic tokens only**: `bg-background`, `text-foreground`, `text-primary`, `border-border`, etc. Never hardcode colors like `bg-white` or `text-black` in components.
- All design tokens live in `src/index.css` (HSL only) and `tailwind.config.ts`.
- Display font: `font-display` (Space Grotesk). Body: default Inter.
- Match the existing component patterns: `Card` for grouped content, `Tabs` for sectioned admin UIs, `Badge` for status pills.

### TypeScript

- Prefer types derived from `Database` in `src/integrations/supabase/types.ts` — see `src/types/index.ts` for extension patterns.
- `any` is allowed for Supabase joined-row shapes when typing them is disproportionate, but isolate to the boundary.

### Database changes

- Schema changes go through the migration tool — never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Every new table needs RLS enabled and explicit policies. Default to `authenticated` role; restrict writes by `has_role(...)`.
- Use the `update_updated_at_column()` trigger on tables with `updated_at`.

### Edge functions

- One folder per function under `supabase/functions/<name>/index.ts`.
- Use the service role key only when bypassing RLS is intentional (e.g., seeding).
- Read secrets via `Deno.env.get('SECRET_NAME')`.

---

## Booking workflow (domain rules)

A booking moves through: `suggested → soft_booked → confirmed` (or `cancelled` from any state).

- Soft-bookings auto-expire after `app_settings.soft_book_expiry_hours` (default 48h).
- A show date has `slots_per_date` slots; once filled, status becomes `fully_filled`.
- Understudies (`is_understudy = true`) auto-promote when the primary cancels.
- Auto-suggest scoring weights are in `BOOKING_CONFIG.SUGGEST_WEIGHTS` and must sum to 1.

---

## Test accounts (development only)

Seeded by `supabase/functions/seed-test-data`:

- `test-admin@showflowpro.com`
- `test-producer@showflowpro.com`
- `test-artist@showflowpro.com`

Passwords are documented in the seeding function; **rotate before any production deploy.**

---

## Things to avoid

- Editing files under `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Storing roles on `profiles`, or doing role checks via `localStorage`.
- Adding `WITH CHECK (true)` policies on log/audit tables.
- Hardcoding colors, fonts, or route strings.
- Coupling client logic to a specific tenant or production brand — the platform is product-agnostic.
