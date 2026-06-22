# In-app Show & Show-Date management (catalog + dates CRUD) — design

**Status:** Approved (brainstorming complete)
**Date:** 2026-06-22
**Author:** Stefan Schaal (with Claude)
**Related:** Self-service initiative (sub-project 1 of N — "Operate: do the core job without a DB").
Sibling sub-projects (not in scope here): frictionless org onboarding; admin/account self-service;
data & compliance self-service. Touches the booking-engine ignition spec
`docs/superpowers/specs/2026-06-21-open-offer-tier-action-design.md` (the "Open tier-1 offers now"
checkbox reuses `open-offer-tier`), the Airtable engine
`docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md` (synced-row ownership), and
`docs/superpowers/specs/2026-06-20-airtable-date-cancellation-design.md` (the cancel cascade trigger
this surfaces in-app for the first time).

## Context & goal

Showflow Pro can read, filter, and book against `show_dates`, but **cannot create, edit, or delete
shows or dates from the app**. Today dates are born only from the `airtable-poll` cron
([supabase/functions/airtable-poll/index.ts](../../../supabase/functions/airtable-poll/index.ts)) or a
hand-insert in the Supabase dashboard; productions (`shows`) are created only via Airtable catalog
import (`importShowsFromOptions` in [src/data/settings.ts](../../../src/data/settings.ts)). CLAUDE.md
records the gap verbatim: *"No UI for creating show dates… must be inserted via the Supabase dashboard
or a future admin-only flow."* This forces the operator (super-admin) and producers out of the product
to do their core job — the opposite of self-service.

**The backend is already complete.** Verified in the codebase:

- **RLS** (migration `20260416115633`): *"Admins and producers can create shows"* / *"…update shows"* /
  *"Admins can delete shows"*; *"Admins and producers can manage show_dates"* (INSERT) / *"…update
  show_dates"* / *"Admins can delete show_dates"*. No new policies needed.
- **Status is DB-computed** — `sync_show_date_status_trigger` (on `bookings`) sets
  `open|partially_filled|fully_filled`; a trigger on `shows` recomputes a show's dates when
  `program/sub_program/main_cast_slots/understudy_slots` change. Client never sets status (except
  `cancelled`).
- **`org_id` auto-derives on insert** — `trg_derive_org_id` (`derive_org_id_from_show_date_id`,
  migration `20260604130000`) sets `show_dates.org_id` from `show_id`. `shows.org_id` has no derive
  trigger (it is the root) and must be passed.
- **Editing a date already notifies** — `log_show_date_schedule_change` (migration `20260620140000`)
  logs date/session/venue changes to `show_date_change_log` and notifies booked artists.
- **Cancelling a date already cascades** — `cascade_cancel_bookings_on_date_cancel` (migration
  `20260620130000`) releases the date's bookings when `status → 'cancelled'`. **No in-app control
  fires this yet** — cancellation only arrives via the Airtable poll today. We add that control.

So this sub-project is **frontend + a thin tested data layer + one tiny migration** (a `sort_order`
column for drag-reorder). No new tables, no new RLS, no new edge functions.

**Goal:** admins/producers create, edit, archive/cancel, reorder, and (safely) delete **productions**
and **dates** entirely in-app, with Airtable-sourced rows protected from accidental divergence.

## Decisions (locked in brainstorming)

1. **Scope = full catalog CRUD + dates CRUD.** Productions get a dedicated management surface
   (create / edit / rename / archive / delete / **drag-reorder**); dates get create / edit / cancel /
   delete. (Chosen over "dates only" and "dates + lightweight show-create".)
2. **Synced rows are locked** (source-of-truth = Airtable). A row is *synced* when its link key is set
   (`show_dates.airtable_record_id` / `shows.airtable_program_key`). Locked fields render read-only with
   a "Synced from Airtable" badge; **manual rows (no key) are fully editable/deletable**. Fields the
   poll never writes stay editable even on synced rows (date `notes`; show `slots`/`description`/
   `category`). Deleting a synced row is blocked (offer Cancel/Archive). (Chosen over "edits allowed,
   sync wins" and "detach on edit".) See §6 for the exact field matrix.
3. **Cancel-first; hard-delete only for empties.** Cancel (audited, releases bookings via trigger) is
   the default for any date with bookings. **Hard-delete is offered only for a manual date with zero
   bookings** (typo cleanup), admin-only. Shows mirror this: **Archive** is the normal path; hard-delete
   only for a manual show with **zero dates** (because `show_dates.show_id` is `ON DELETE CASCADE` —
   deleting a show with dates would silently cascade-delete its dates *and* their bookings with no
   trigger/notification). (Chosen over "delete with warning" and "cancel-only".)
4. **Reorder kept** → one DB migration: `shows.sort_order smallint` (nullable). Drag-reorder via
   framer-motion `Reorder` (already a dependency — `framer-motion@^12`); no new package.
5. **Slot editing consolidates into Productions.** The `ShowSlotsEditor` in Settings → Scheduling
   ([src/pages/SettingsPage.tsx:63](../../../src/pages/SettingsPage.tsx)) is replaced by slot fields in
   the production form; the Scheduling tab becomes a short pointer (keeps the "N unconfigured" warning,
   links to Productions). One editor for one field.
6. **Permissions mirror RLS** — create/edit/archive/cancel = admin + producer; hard-delete = admin only
   (UX-gated by `hasRole`; RLS enforces server-side).
7. **Logic lives in tested units.** Supabase reads/writes → `src/data/shows.ts` + `src/data/showDates.ts`
   (client passed in; `createFakeSupabase`). Branch/format/guard logic → pure helpers in
   `src/lib/catalog.ts`. Dialogs/pages are thin wiring.

## Architecture & data flow

```
Productions page (ROUTES.PRODUCTIONS, admin|producer)        Shows & Bookings page (existing)
  │                                                            │  [+ New date] (canManage)
  ├ useShows() → fetchShowsWithStats(supabase, orgId)          └─► ShowDateFormDialog (create)
  │    shows ORDER BY sort_order NULLS LAST, program, sub        │     show picker (non-archived) + [+ New production]
  │    + per-show dateCount (one show_dates(show_id) scan)       │     date (Calendar weekStartsOn=1), session_1..3,
  │    → rows: program·sub · category · slots · status · #dates  │     venue, city, notes, [□ Open tier-1 offers now]
  │                                                              │     submit → createShowDate(supabase,{...,org_id})
  ├ [+ New production] / row Edit → ShowFormDialog               │       (trg_derive_org_id re-derives org_id)
  │    program, sub_program, category, description,              │     if openOffers → openOfferTier(supabase,{id,tier:1})
  │    main_cast_slots, understudy_slots                         │     invalidate ['show-dates'] (+ ['bookings'])
  │    synced show → program/sub_program read-only (badge)       │
  │    create → createShow(supabase,{...,org_id,created_by})    ShowDateDetailSheet (existing, extended)
  │    edit   → updateShow(supabase,id,patch)                    │  Edit schedule → ShowDateFormDialog (edit)
  │    invalidate ['shows'] + ['show-dates']                     │    synced date → date/sessions/venue/city locked;
  │                                                              │    notes always editable → updateShowDate(...)
  ├ row Archive/Unarchive → archiveShow(supabase,id,bool)        │  Cancel date (NEW) → cancelShowDate(supabase,id,reason)
  │    status 'archived'|'active'; invalidate ['shows']          │    status→'cancelled' fires cascade trigger
  │                                                              │  Delete date → canHardDeleteDate({synced,bookingCount})
  ├ row Delete (admin) → canHardDeleteShow({synced,dateCount})   │    enabled iff !synced && bookingCount===0 (admin)
  │    enabled iff !synced && dateCount===0                      │    → deleteShowDate(supabase,id)
  │    → deleteShow(supabase,id); invalidate ['shows']           │
  │                                                            Settings → Scheduling (existing, trimmed)
  └ drag-reorder (framer-motion Reorder)                         └ ShowSlotsEditor removed → "Manage slots on
       → reorderShows(supabase, orderedIds)                          Productions" link; keeps unconfigured warning
       writes sort_order = index; invalidate ['shows']
```

## The one DB migration

`shows.sort_order smallint` (nullable), applied via the migration tool (Supabase MCP / CI — never
hand-edit `supabase/migrations/` or `types.ts`; regenerate types after).

```sql
alter table public.shows add column sort_order smallint;

-- Stable initial order for existing rows (per org, current alphabetical order):
with ranked as (
  select id, row_number() over (partition by org_id order by program, sub_program) as rn
  from public.shows
)
update public.shows s set sort_order = ranked.rn from ranked where ranked.id = s.id;
```

New shows get `sort_order = (max for org) + 1` (computed in `createShow`); ordering is `sort_order NULLS
LAST, program, sub_program` so any null sorts to the end deterministically. No RLS change (existing
update policy covers the column).

## Components

### 1. `src/data/shows.ts` (new) — show CRUD boundary

All take `client: SupabaseClient<Database>` first (never import the singleton here).

- `fetchShowsWithStats(client, orgId) → ShowRow[]` — select `id, program, sub_program, category,
  description, status, main_cast_slots, understudy_slots, airtable_program_key, sort_order`; order
  `sort_order` (nulls last), `program`, `sub_program`. Then one `show_dates` scan
  (`select show_id` eq org, non-cancelled) reduced client-side to a `Map<show_id, count>`; attach
  `dateCount`. (Avoids N per-row count queries.)
- `createShow(client, { orgId, createdBy, program, sub_program, category, description, mainCastSlots,
  understudySlots, sortOrder }) → { id }` — insert with `status: 'active'`. `org_id` required (no derive
  trigger on `shows`); `created_by` set for provenance.
- `updateShow(client, id, patch)` — patch any of program/sub_program/category/description/
  main_cast_slots/understudy_slots. (Supersedes `updateShowSlots`.)
- `archiveShow(client, id, archived: boolean)` — `status: archived ? 'archived' : 'active'`.
- `deleteShow(client, id)` — raw delete (admin RLS; caller guards on `canHardDeleteShow`).
- `reorderShows(client, orderedIds: string[])` — write `sort_order = index` for each id (sequential
  updates; small N). Returns void.

### 2. `src/data/showDates.ts` (new) — date CRUD boundary

- `createShowDate(client, { orgId, showId, date, session1, session2, session3, venue, cityId, notes }) →
  { id }` — insert; pass `org_id` for type-satisfaction (re-derived by `trg_derive_org_id`). Status
  omitted → DB default `open`.
- `updateShowDate(client, id, patch)` — patch date/session_1..3/venue/city_id/notes. (Schedule-field
  changes fire `log_show_date_schedule_change` automatically.)
- `cancelShowDate(client, id, reason: string)` — `update({ status: 'cancelled', cancellation_reason:
  reason })`; fires `cascade_cancel_bookings_on_date_cancel`. **New capability** (no in-app cancel
  existed).
- `deleteShowDate(client, id)` — raw delete (admin RLS; caller guards on `canHardDeleteDate`).

### 3. `src/lib/catalog.ts` (new) — pure helpers (no I/O)

- `isSyncedShow(s) = !!s.airtable_program_key` ; `isSyncedDate(d) = !!d.airtable_record_id`.
- `canHardDeleteDate({ synced, bookingCount }) = !synced && bookingCount === 0`.
- `canHardDeleteShow({ synced, dateCount }) = !synced && dateCount === 0`.
- `findDuplicateDate(existing, { showId, date }) → ShowDateRow | null` — first non-cancelled row with the
  same `show_id` & `date` (drives a soft, non-blocking create warning).
- `nextSortOrder(shows) → number` — `max(sort_order ?? 0) + 1`.
- Reuse `showLabel(show)` from [src/types/index.ts:47](../../../src/types/index.ts) for display.

### 4. `src/hooks/useShows.ts` + `src/hooks/useShowDates.ts` (new) — thin wrappers

Pass the `supabase` singleton + `currentOrg.id`. `useShows()` → `['shows','list',orgId]`. Mutations:
`useCreateShow/useUpdateShow/useArchiveShow/useDeleteShow/useReorderShows` invalidate **`['shows']`**
(prefix) and **`['show-dates']`** (date rows join show fields like slots/program/status).
`useCreateShowDate/useUpdateShowDate/useCancelShowDate/useDeleteShowDate` invalidate **`['show-dates']`**
(+ **`['bookings']`** for cancel/delete, which change bookings). Per CLAUDE.md: bust whole domain
prefixes, never individual sub-keys.

### 5. `src/components/shows/ShowDateFormDialog.tsx` (new) — create + edit date

`react-hook-form` + `zod`. Props: `{ mode: 'create'|'edit', showDateId?, defaultShowId?, open,
onOpenChange }`. Fields: production picker (shadcn `Select`/`Command`, **non-archived only**, with a
**"+ New production"** item opening `ShowFormDialog` nested and preselecting the result); date (shadcn
`Calendar` in a `Popover`, **`weekStartsOn={1}`**); `session_1..3` (HH:MM inputs); venue (`Input`); city
(`Select` from `cities`); notes (`Textarea`). **Create-only:** `□ Open tier-1 offers now` — disabled
with helper text when the chosen show has no slots configured; on submit success calls
`openOfferTier(supabase, { showDateId, tier: 1 })` ([src/data/bookings.ts](../../../src/data/bookings.ts)).
**Edit + synced** (`isSyncedDate`): date/sessions/venue/city are read-only with a "Synced from Airtable"
badge; **notes stays editable**. Soft warning (not blocking) via `findDuplicateDate` when a same
show+date already exists. Validation: production + date required; sessions match `HH:MM`.

### 6. Synced-lock field matrix (enforced in the two dialogs)

| Entity | Read-only when synced | Editable when synced | Hard-delete when synced |
|---|---|---|---|
| **Date** (`airtable_record_id` set) | date, session_1..3, venue, city, status | **notes**; cast eligibility; bookings/offers | Blocked → **Cancel** |
| **Show** (`airtable_program_key` set) | program, sub_program | **slots, description, category** | Blocked → **Archive** |
| **Manual** (no key) | — | everything | Per §Decisions 3 |

Rationale: the poll overwrites a synced date's `date/session_*/venue/city_id/custom/status` every run, so
editing them in-app would silently revert — lock them. It never writes `notes`. For shows the poll only
*reads* `airtable_program_key`, so slots/description/category are app-owned and editable; program/
sub_program are locked because they are the Airtable labels (renaming diverges from the source even
though the key still matches). The lock is UX-level (RLS still permits writes; the poll would correct a
forced edit anyway).

### 7. `src/components/catalog/ShowFormDialog.tsx` (new) — create + edit production

`react-hook-form` + `zod`. Fields: program, sub_program, category, description, main_cast_slots,
understudy_slots (nullable non-negative smallints; empty = null = "unconfigured"). Synced show:
program/sub_program read-only + badge; slots/description/category editable. `create → useCreateShow`
(computes `sortOrder = nextSortOrder(shows)`, `createdBy = user.id`); `edit → useUpdateShow`.

### 8. `src/pages/ProductionsPage.tsx` (new) — the catalog surface

Default export; registered in `App.tsx` under `<ProtectedRoute requiredRoles={['admin','producer']}>`.
A `Card` table: production (`showLabel`) · category · slots (`m + u`, or "Unconfigured" badge when null)
· status badge · # upcoming dates. Header: status filter (active/archived/all) + **[+ New
production]**. Row actions: **Edit** (all canManage), **Archive/Unarchive** (canManage), **Delete**
(admin only; `disabled` unless `canHardDeleteShow`, tooltip explains "archive instead — has N dates / is
Airtable-synced"). **Drag-reorder** via framer-motion `Reorder.Group`/`Reorder.Item` over the active
list → `useReorderShows(orderedIds)`. Loading → `Skeleton`; error → `Alert variant="destructive"`.

### 9. Edits to existing files

- [src/pages/ShowsBookingsPage.tsx](../../../src/pages/ShowsBookingsPage.tsx) — add a **[+ New date]**
  button (canManage) in the header, opening `ShowDateFormDialog` in create mode. (Already invalidates
  `['show-dates']` via realtime + query.)
- [src/components/shows/ShowDateDetailSheet.tsx](../../../src/components/shows/ShowDateDetailSheet.tsx) —
  add an **Edit schedule** action (opens `ShowDateFormDialog` edit), a **Cancel date** action (canManage,
  status≠cancelled → `cancelShowDate`, `AlertDialog` with a reason field; reuses the existing
  `AlertDialog` imports), and a **Delete date** action (admin; enabled only when `canHardDeleteDate`).
  Migrate the existing inline `city_id` update to `updateShowDate`. The booking-count for the delete gate
  comes from the sheet's existing `bookingsForDate` query.
- [src/components/layout/navItems.ts](../../../src/components/layout/navItems.ts) — add a **Productions**
  item (`ROUTES.PRODUCTIONS`, roles `['admin','producer']`, lucide icon e.g. `Theater`/`ListMusic`).
- [src/config/app.config.ts](../../../src/config/app.config.ts) — add `PRODUCTIONS: '/productions'` to
  `ROUTES`.
- [src/App.tsx](../../../src/App.tsx) — register the route, mirroring the existing `BOOKINGS`/`ARTISTS`
  routes: `<Route path={ROUTES.PRODUCTIONS} element={<ProtectedRoute requiredRoles={['admin','producer']}>
  <AppLayout><ProductionsPage/></AppLayout></ProtectedRoute>} />`.
- [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx) — replace `ShowSlotsEditor`'s editing
  grid with a one-line "Slot configuration has moved to **Productions**" + link; keep the "N
  unconfigured" `Alert` as a pointer. **`fetchShowsWithSlots` stays** —
  [useSettingsWarnings.ts](../../../src/hooks/useSettingsWarnings.ts) depends on it for that count.
  **`updateShowSlots` is removed** (only `ShowSlotsEditor` called it; slot writes now go through
  `updateShow`), along with its `describe` block in `settings.test.ts`.
- [CLAUDE.md](../../../CLAUDE.md) — update the "No UI for creating show dates" decision and add the
  Productions page + synced-lock rule to the architecture notes.

## Permissions (mirror existing RLS; UX-gated by `hasRole`)

| Action | Admin | Producer | Artist |
|---|---|---|---|
| Create / edit show & date; archive show; cancel date; reorder | ✅ | ✅ | ✕ |
| Hard-delete show / date | ✅ | ✕ | ✕ |

## Testing strategy (test-first)

Dev machine is **Deno-only**; vitest/tsc/eslint run in **CI** (`npm run test` = `vitest run`). Write
tests first; they execute in CI. Data-access uses `src/test/supabaseFake.ts` (`createFakeSupabase`);
components use `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts`. Never `vi.mock` the client.

| Layer | File | Covers |
|---|---|---|
| Pure (vitest, CI) | `src/lib/catalog.test.ts` (new) | `isSyncedShow/Date`; `canHardDeleteDate` & `canHardDeleteShow` truth tables (synced×count); `findDuplicateDate` (ignores cancelled, matches show+date); `nextSortOrder` (empty/nulls/max). |
| Data (vitest, CI) | `src/data/shows.test.ts` (new) | `createShow` (status active, org_id, created_by, sort_order in payload); `updateShow`/`archiveShow`/`deleteShow`/`reorderShows` send correct ops; `fetchShowsWithStats` orders + attaches dateCount (excludes cancelled). |
| Data (vitest, CI) | `src/data/showDates.test.ts` (new) | `createShowDate` (no status set; org_id passed); `updateShowDate` patch; `cancelShowDate` (status='cancelled' + reason); `deleteShowDate`. |
| Component (vitest, CI) | `src/components/shows/ShowDateFormDialog.test.tsx` (new) | validation (production/date required, HH:MM); synced date → schedule fields disabled + notes enabled; duplicate soft-warning; "open offers" disabled when no slots. |
| Component (vitest, CI) | `src/components/catalog/ProductionsPage.test.tsx` (new) | renders rows + unconfigured badge; delete disabled when synced or dateCount>0; archive toggles; producer sees no delete; reorder calls `reorderShows`. |

No standalone test for `ShowDateDetailSheet` (its other reads use the inline singleton, against
mock-the-client convention) — new behavior is covered by the data/pure/dialog units; the sheet is thin
wiring verified manually + in CI.

## Risks & edge cases

- **Show-delete cascade** — `show_dates.show_id` and `show_cast_eligibility.show_id` are `ON DELETE
  CASCADE`; a show delete with dates would wipe dates→bookings silently (no trigger). Mitigated by the
  `canHardDeleteShow` zero-date guard + admin-only + Archive default. (Belt-and-suspenders: the guard is
  client-side; RLS allows the delete, but the operator must clear/cancel dates first.)
- **Manual/Airtable duplicate dates** — the poll keys on `airtable_record_id` and won't touch manual
  rows, but a manual date duplicating an Airtable one yields two rows. Surfaced as a non-blocking create
  warning (`findDuplicateDate`); not hard-prevented (no DB uniqueness on `(show_id,date)`).
- **Deleting a synced date is futile** — the Airtable record still exists, so the next poll re-imports
  it. Hence delete is blocked on synced rows (Cancel instead; the poll preserves a `cancelled` status
  unless the Airtable status flips).
- **Unconfigured slots** — a new date for a slot-less show is valid but shows the existing
  `unconfigured` display status; the form links to set slots and disables "open offers". Status stays
  DB-computed.
- **org_id derivation** — passing `currentOrg.id` on date insert is redundant with `trg_derive_org_id`
  but satisfies the `Insert` type and the `org_isolation` WITH CHECK; the trigger re-derives from
  `show_id` (authoritative).
- **Reorder concurrency** — `reorderShows` writes indices for the visible active set; a stale order just
  re-saves on next drag. `sort_order` is advisory (display only), never used in booking logic.
- **Query-key correctness** — show mutations bust both `['shows']` and `['show-dates']` because the
  bookings list joins show fields; date cancel/delete also busts `['bookings']`.

## File touch-list

- `supabase/migrations/<ts>_shows_sort_order.sql` (new, via tool) + `types.ts` regen.
- `src/data/shows.ts` (new) + `src/data/shows.test.ts` (new).
- `src/data/showDates.ts` (new) + `src/data/showDates.test.ts` (new).
- `src/lib/catalog.ts` (new) + `src/lib/catalog.test.ts` (new).
- `src/hooks/useShows.ts` (new), `src/hooks/useShowDates.ts` (new).
- `src/components/shows/ShowDateFormDialog.tsx` (new) + test.
- `src/components/catalog/ShowFormDialog.tsx` (new); `src/pages/ProductionsPage.tsx` (new) + test.
- `src/components/shows/ShowDateDetailSheet.tsx` (edit — Edit/Cancel/Delete; route city update through
  `updateShowDate`).
- `src/pages/ShowsBookingsPage.tsx` (edit — New date button).
- `src/components/layout/navItems.ts`, `src/config/app.config.ts`, `src/App.tsx` (edit — route + nav).
- `src/pages/SettingsPage.tsx` (edit — Scheduling tab → pointer); `src/data/settings.ts` (remove
  `updateShowSlots`, keep `fetchShowsWithSlots`) + `src/data/settings.test.ts` (drop the `updateShowSlots`
  `describe`).
- `CLAUDE.md` (edit — supersede the "no create-show-date UI" decision; document Productions +
  synced-lock).

## Non-goals (YAGNI)

- Bulk CSV import of dates or shows (separate sub-project).
- Recurring/series date generation; bulk multi-date edit/cancel.
- Editing Airtable-managed fields in-app (synced rows stay locked); no "detach from Airtable".
- A DB uniqueness constraint on `(show_id, date)` (soft warning only).
- Merging/splitting productions; moving dates between shows.
- Any change to the booking engine, offer tiers, or notifications beyond reusing `open-offer-tier` and
  the existing cancel/schedule-change triggers.
