

## Plan: Unified Shows & Bookings, Cast Eligibility on Artists Sheet, Dashboard Cast Cards

### 1. Move Cast Eligibility to the Artist side panel

- The current `EligibilityPanel` (per-show × city → casts) on `ShowDetailPage` is removed from the show page.
- Replace `CastMembersSheet` with a richer `CastDetailsSheet` opened from `CastsSection` on `/artists`. New tabbed layout inside the sheet:
  - **Members** — the existing add/remove artists UI.
  - **City eligibility** — a matrix: rows = cities, columns = shows. Each cell is a checkbox; toggling writes/deletes a row in `show_cast_eligibility` (`show_id`, `city_id`, `cast_id` of this cast). This makes "where this cast is eligible" a property of the cast, configured from the artists view.
- Existing per-date overrides (`show_date_cast_eligibility`) and the date-config card on `ShowDetailPage` remain — that's still the place to override per individual show date.

### 2. Unify Shows & Bookings into one page (`/bookings`)

- New `ShowsBookingsPage` mounted at `ROUTES.BOOKINGS` (`/bookings`). Old `/shows` route redirects to `/bookings`. Sidebar entry "Shows" removed; "Bookings" renamed to "Shows & Bookings".
- `ShowDetailPage` continues to exist at `/shows/:id` (for direct deep links), but the unified page also opens shows in a **side sheet** instead of navigating away — the sheet renders the existing show detail (dates list + bookings tab + chat tab) inline.
- **List view** is a true table (using shadcn `Table`) with these columns:
  1. **Date** — earliest upcoming `show_date.date` formatted `DD/MM/YYYY`
  2. **Program** — `shows.program`
  3. **Sub Program** — new `shows.sub_program` column
  4. **Venue** — `shows.venue`
  5. **Booking Status** — derived: `Cast Confirmed` (all slots on next date confirmed), `Cast Pending` (slots not fully confirmed), `Open` (no bookings yet), `Cancelled`
  6. **Show 1 / Show 2 / Show 3** — the first 3 `start_time`s of the next upcoming `show_date` (ordered). Empty cell if fewer.
- Filter bar keeps the existing program / timeframe / sort / view-toggle controls. **New filter: "Cast Pending"** added to a status dropdown (`All / Cast Confirmed / Cast Pending / Open / Cancelled`) gated by `canSee('status')`.
- Calendar view: keep existing `EntityCalendar`, plotting next show date per show; clicking opens the same side sheet.
- Clicking a row → opens `ShowDetailSheet` (right-side `Sheet`) showing bookings for that show.

### 3. Schema additions

One migration:

- `ALTER TABLE shows ADD COLUMN sub_program text` (nullable).
- No other schema changes — `Cast Pending` is computed client-side from `bookings.status` + `shows.slots_per_date`.

### 4. Dashboard cards

Replace the four existing stat cards on `DashboardPage` with three cast-status cards:

- **Card 1 — Live & upcoming**: count of `show_dates` with `date >= today`, plus "Cast confirmed: X%" (dates where all `slots_per_date` slots are filled with `confirmed` bookings ÷ total upcoming dates).
- **Card 2 — Next 14 days**: same percentage scoped to `today …+14d`, with the count of distinct shows in that range below.
- **Card 3 — Next 30 days**: same for `today …+30d`.

Each card is a `Link` to:

```text
/bookings?status=cast_pending&from=YYYY-MM-DD&to=YYYY-MM-DD
```

`ShowsBookingsPage` reads `searchParams` on mount and pre-applies the timeframe + status filters.

### 5. Files to create / edit

```text
NEW:
  src/pages/ShowsBookingsPage.tsx              (table + filters + side sheet)
  src/components/shows/ShowDetailSheet.tsx     (sheet wrapper around show detail content)
  src/components/casts/CastDetailsSheet.tsx    (replaces CastMembersSheet — adds eligibility tab)
  supabase/migrations/<ts>_add_sub_program.sql

EDIT:
  src/App.tsx                                  (redirect /shows → /bookings, mount new page)
  src/components/layout/AppLayout.tsx          (drop Shows nav, rename Bookings)
  src/pages/DashboardPage.tsx                  (3 new cast cards with deep-link search params)
  src/pages/ArtistsPage.tsx                    (use new CastDetailsSheet)
  src/pages/ShowDetailPage.tsx                 (remove EligibilityPanel import/use)
  src/pages/ShowsPage.tsx                      (DELETE)
  src/pages/BookingsPage.tsx                   (DELETE)
  src/components/casts/EligibilityPanel.tsx    (DELETE — logic moves into CastDetailsSheet)
  src/components/casts/CastMembersSheet.tsx    (DELETE — superseded)
  src/components/filters/SortControl.tsx       (no change; reused)

KEEP:
  /shows/:id route (deep-link target for show detail page)
```

### 6. Computed "Booking Status" rules (column + filter)

For a show, look at the **next upcoming** show_date:

- `Cancelled` — if status = cancelled.
- `Cast Confirmed` — count of bookings with status `confirmed` ≥ `slots_per_date`.
- `Cast Pending` — has bookings but confirmed count < `slots_per_date`.
- `Open` — zero bookings.

If there are no upcoming dates, status is `—` and the show is hidden from the Cast Pending filter.

### 7. Out of scope

- No backfill of `sub_program` data — admins fill it manually until Airtable mapping ships.
- Booking row-level actions (Confirm / Soft Book / Cancel buttons currently on `BookingsPage`) move into the show detail sheet. The unified page table is read-only at the row level — actions happen inside the sheet.
- Keyboard nav / multi-select on the table is not implemented.

