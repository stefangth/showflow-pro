

## Plan: Artist-scoped views, side-view date format, dev login, calendar availability

Skipping (already built today): admin-gated signup flow, Google OAuth wiring, IAM admin list, approvals tab, transactional email infra. Below is only what's still outstanding.

---

### 1. Side-view date discrepancies (Shows & Bookings, Show detail sheet)

**Cause of discrepancy**: `ShowDetailPage` (rendered inside the side sheet) formats `show_dates` with `format(new Date(d.date), 'EEEE, MMM d, yyyy')`, while the list/calendar use `dd/MM/yyyy`. There is **no data discrepancy** — both views read from the same `show_dates` rows. The mismatch is purely the display format and the parsing of date-only strings without a timezone (`new Date('2026-04-23')` is parsed as UTC, which can shift a day in negative timezones).

**Fix**:
- In `ShowDetailPage.tsx`, format every `show_date.date` as `dd/MM/yyyy` and parse with `new Date(d.date + 'T00:00:00')` (timezone-safe, matching `ShowsBookingsPage`).
- Same fix in `CastDetailsSheet.tsx` and any other sheet showing dates.
- Add a tiny shared helper `src/lib/dates.ts` exporting `formatDateDMY(dateStr)` and `parseDateOnly(dateStr)` so the convention is enforced everywhere; refactor existing call sites.

### 2. Developer login + IAM "Assign role" control

- Add **"Assign role"** controls to the existing IAM Users tab: per-user role multi-select (Artist / Producer / Admin) backed by inserts/deletes into `user_roles` via a new edge function `admin-set-role` (service role; verifies caller has admin via `has_role`).
- Add a one-time bootstrap: a **Settings > Developer** card visible only when the current user has zero approvals/roles configured AND their email matches a developer seed list (env-driven), letting them self-promote to admin. Once any admin exists this card hides.
- For the user's own dev account: the simpler path is to run a one-off `INSERT` via the migration tool to (a) auto-approve their `user_approvals` row and (b) grant `admin` in `user_roles`. Will execute this once the user confirms which email to elevate.

### 3. Remove `/artists` view + permissions

- Drop the route from `src/App.tsx`, the nav item from `AppLayout.tsx`, and the constant from `ROUTES`.
- Delete `src/pages/ArtistsPage.tsx`.
- Keep the `artists` table and producer/admin write access — artist *management* still happens via the IAM tab and the booking flow inside `/shows/:id`.

### 4. Artist-scoped data on `/bookings`, `/dashboard`, `/availability`

A new shared hook `useArtistEligibleDates()` returns the set of `show_date` IDs the current artist is eligible for, computed as:

```text
artist.id
   └─> cast_members (cast_ids the artist belongs to)
         ├─> show_cast_eligibility   (city-scoped show eligibility)
         └─> show_date_cast_eligibility (per-date overrides)
               └─> resulting show_date IDs (filter to date >= today)
```

Used to gate every artist-facing query:

- **`/bookings` (artist role)**: same list/calendar UI as producers, but filtered to eligible `show_dates`. Side view (ShowDetailSheet) for an artist hides Date configuration / cast-eligibility editors and instead shows the artist's own availability + booking status for that single date with the Available / Not available / Tentative selector.
- **`/dashboard` (artist role)**: replace the producer cards with an artist-only card:
  - "Response rate": `% of eligible upcoming dates where an availability row exists`.
  - Click → navigate to `/availability?filter=unanswered` showing only the unanswered eligible dates.
- **`/availability` (artist role)**: rebuilt to mirror `/bookings`:
  - Same filter bar (timeframe, sort, view toggle).
  - List view: rows of eligible upcoming dates with a Select (Available / Not available / Tentative / Clear).
  - Calendar view: month grid where each eligible date renders with:
    - **Bold blue outline** → offered (date is in eligibility set).
    - **Red shade** → artist marked Not available.
    - **Green shade** → artist has a `confirmed` booking on that date.
    - Yellow shade for Tentative (existing token), neutral for Available, no shade for unanswered.
  - Tapping a calendar cell opens a small popover dropdown with Available / Not available / Tentative; selection upserts into `availability`. List view uses the same options inline.
- Producers/admins keep the current `/availability` view (their own availability still editable; no eligibility filter).

### 5. Routing & role gating

- `ProtectedRoute` continues to gate by role. Artist-only routes: `/dashboard`, `/bookings`, `/availability`, `/chats`. Remove `/artists` entirely.
- The artist variants of Bookings/Dashboard/Availability are selected inside the page component via `hasRole('artist') && !hasRole('producer') && !hasRole('admin')`, so admins can still preview the producer view.

### 6. Files to create / edit

```text
NEW:
  src/lib/dates.ts                              (formatDateDMY, parseDateOnly)
  src/hooks/useArtistEligibleDates.ts
  src/hooks/useMyArtist.ts                      (already-inline pattern, extracted)
  src/components/availability/AvailabilityPicker.tsx  (calendar popover + list select)
  src/components/availability/ArtistAvailabilityCalendar.tsx
  src/components/dashboard/ArtistDashboard.tsx
  src/components/bookings/ArtistBookingsView.tsx
  supabase/functions/admin-set-role/index.ts

EDIT:
  src/App.tsx                                   (drop /artists route)
  src/components/layout/AppLayout.tsx           (drop Artists nav)
  src/config/app.config.ts                      (drop ROUTES.ARTISTS)
  src/pages/ShowsBookingsPage.tsx               (artist branch → ArtistBookingsView)
  src/pages/DashboardPage.tsx                   (artist branch → ArtistDashboard)
  src/pages/AvailabilityPage.tsx                (artist branch + producer kept)
  src/pages/ShowDetailPage.tsx                  (DD/MM/YYYY, side-view artist mode)
  src/components/shows/ShowDetailSheet.tsx     (pass `isArtistView` prop)
  src/components/casts/CastDetailsSheet.tsx     (date format fix)
  src/pages/AdminPage.tsx                       (Assign role control in Users tab)

DELETE:
  src/pages/ArtistsPage.tsx
```

### 7. Out of scope

- Bulk availability editing.
- Push/email notifications when an artist is offered a new date (existing `notifications` table only).
- Re-enabling Artists page in the future (kept the table + RLS so it can come back).
- Changes to producer/admin Bookings UX beyond the date-format fix.

