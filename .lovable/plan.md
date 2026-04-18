

## Plan: Filters, Calendar/List Views, and Per-Role Filter Visibility

### 1. Data & config (mock for now)

- Add a `program` (text) column to `shows` (nullable, mock IP field). Will later be replaced by the real Airtable column once the schema is confirmed.
- Seed a small set of mock programs into existing rows (e.g. "Jury Experience", "Ballet of Lights", "Candlelight", "Immersive Van Gogh") so filters have content.
- New `app_settings` keys (JSONB) for filter visibility, defaulting to "all visible":
  - `filters_visibility.shows` → `{ producer: { program, timeframe, sort, status }, artist: { ... } }`
  - `filters_visibility.artists` → same shape
  - `filters_visibility.bookings` → same shape
- New `app_settings.filter_mappings` (JSONB): admin-editable mapping of Showflow filter fields → Airtable column names (e.g. `program → "IP"`, `timeframe → "Show Date"`). Display-only for now; sync worker will read it later.

### 2. Shared filter components (`src/components/filters/`)

- `ProgramFilter` — multi-select, options derived from distinct `shows.program` values.
- `TimeframeFilter` — presets (Today, This week, This month, Next 30/90 days, Past) + custom from/to range using shadcn DatePicker + Popover. Outputs `{from, to}`.
- `SortControl` — dropdown: Alphabetical A→Z / Z→A, Chronological ↑ / ↓. Each page maps "chronological" to its relevant date field (shows → earliest upcoming show_date; artists → created_at or next booking; bookings → show_date.date).
- `ViewToggle` — List / Calendar segmented control.
- `useFilterVisibility(page)` hook — reads `app_settings.filters_visibility[page]`, returns `{ canSee('program'|'timeframe'|'sort'|'status') }`. Admin always sees all; producer/artist gated by settings.

### 3. Calendar view component (`src/components/calendar/`)

- `EntityCalendar` — dual-mode (matches user choice "Both — toggle inside calendar"):
  - **Month grid**: shadcn `Calendar` with day modifiers showing badge count per day; clicking a day opens a side panel listing items.
  - **Agenda**: chronological list grouped by date.
  - Internal toggle: "Month" / "Agenda".
- Accepts `items`, `getDate(item)`, `renderItem(item)` so it's reusable across Shows / Artists / Bookings.

### 4. Page updates

**ShowsPage**: add filter bar (search + program + timeframe + sort + view toggle). Timeframe filters on the show's earliest upcoming date (requires fetching `show_dates` join). Calendar view plots show_dates per day.

**ArtistsPage**: add filter bar (search + skills/program-they-perform-in + timeframe of next booking + sort + view toggle). Calendar view plots each artist's bookings.

**BookingsPage**: add filter bar (status — already present + program + timeframe + sort + view toggle). Calendar view plots bookings on their show_date.

All three pages respect `useFilterVisibility(page)` for non-admin roles.

### 5. SettingsPage — new "Filters" tab

Two sub-sections:

1. **Filter mappings (Airtable)** — table with rows (Program, Timeframe, Sort field, Status) × column "Airtable column name". Free-text inputs, saved into `app_settings.filter_mappings`. Helper text: "These map Showflow filters to your Airtable schema. Mock for now — used once sync is wired up."
2. **Visibility per role** — for each page (Shows, Artists, Bookings) and each non-admin role (Producer, Artist), a row of switches (Program, Timeframe, Sort, Status). Saves into `app_settings.filters_visibility`.

### 6. Files to create / edit

```text
NEW:
  src/components/filters/ProgramFilter.tsx
  src/components/filters/TimeframeFilter.tsx
  src/components/filters/SortControl.tsx
  src/components/filters/ViewToggle.tsx
  src/components/filters/useFilterVisibility.ts
  src/components/calendar/EntityCalendar.tsx
  supabase/migrations/<ts>_add_program_and_filter_settings.sql

EDIT:
  src/pages/ShowsPage.tsx       (filter bar + list/calendar + program in create form)
  src/pages/ArtistsPage.tsx     (filter bar + list/calendar)
  src/pages/BookingsPage.tsx    (extend filter bar + list/calendar)
  src/pages/SettingsPage.tsx    (new "Filters" tab with mappings + visibility)
  src/types/index.ts            (Show.program type already inferred from regenerated types)
```

### 7. Out of scope (call out explicitly)

- No real Airtable parsing — `program` is a free text/mock field. Will revisit once client provides Airtable schema.
- Filter visibility for `Availability` and `Admin` pages not included (not requested).
- Sort/filter is client-side (existing pages already fetch full lists). Acceptable at current scale; pagination can come later.

