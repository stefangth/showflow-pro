# Airtable-driven date cancellation + reason — design

**Status:** Draft (awaiting review)
**Date:** 2026-06-20
**Author:** Stefan Schaal (with Claude)
**Related:** ADR-0009 (custom synced fields), Airtable sync initiative, `bookings.cancellation_reason` (per-booking — unrelated to this date-level field)

## Context & goal

Producers manage the show schedule in Airtable. When a date is cancelled there, the app
currently has no idea: `airtable-poll` never syncs status, nothing sets
`show_dates.status='cancelled'`, and a cancelled date (however it got cancelled) shows no reason
anywhere — the date just silently behaves as open/filled, and its artists keep getting offer and
confirmation emails.

**Goal:** when a date's Airtable **Status** = **"Cancelled"**, reflect that in the app — mark the
date cancelled, import the cancellation **reason**, surface it inline in the producer show flow, and
release the artists booked on that date.

This is **not** about the existing per-booking `bookings.cancellation_reason` (a status code like
`artist_declined`). This is a new **date-level** reason sourced from Airtable.

## Decisions (locked in brainstorming)

1. **Airtable is the source of truth** for date cancellation. The sync becomes the first writer of
   `show_dates.status='cancelled'`.
2. **Airtable shape:** a single-select **Status** field whose **"Cancelled"** option is the signal,
   plus a separate **Reason** text field. (Both are admin-mapped, not hard-coded.)
3. **Reason storage:** a dedicated nullable `show_dates.cancellation_reason text` column — chosen
   over the generic `custom` jsonb bag because it is status-coupled, renders conditionally, and
   avoids a "which custom field is the reason?" designation problem.
4. **Release the artists:** cancelling a date cascades to its active bookings (cancel them,
   reason `date_cancelled`), suppressing understudy auto-promotion. Digests/offers then stop
   naturally (they exclude cancelled bookings).
5. **Surfaces:** producer **Bookings list** (inline under the "Cancelled" badge) and
   **ShowDateDetailSheet** (a destructive banner). **Artists who had any active booking on the date**
   (a pending offer, soft-booked, or confirmed) also see the cancelled entry + reason in **My
   Bookings** — it is *not* hidden from them. The artist
   **availability** calendar and dashboard are unchanged (a dead date isn't an availability target;
   the released artist still learns of it via the existing cancellation notification + My Bookings).

## Why this is safe (key invariant)

`compute_show_date_status()` short-circuits at the top when the current status is `'cancelled'`
([slots_on_shows.sql:36](../../../supabase/migrations/20260616172104_slots_on_shows.sql)), in every
historical version of the function. So once the sync writes `cancelled`, no booking/show mutation
can silently un-cancel it. The Airtable `show_dates` UPDATE does not itself invoke the recompute
trigger (that trigger lives on `bookings`), so the written status is durable.

## Architecture & data flow

```
Airtable record (Status single-select, Reason text)
   │  (every 5 min, per org)
   ▼
airtable-poll  ──reads field map──▶ is Status == mapped "Cancelled" value?
   │                                    │ yes                  │ no, but row currently cancelled
   │                                    ▼                      ▼
   │                       payload.status='cancelled'   payload.status='open' (revival)
   │                       payload.cancellation_reason   payload.cancellation_reason=null
   ▼
UPDATE show_dates ──▶ AFTER UPDATE trigger (status → 'cancelled')
                          ▼
                       cancel all active bookings for the date
                       (reason 'date_cancelled'); understudy
                       promotion suppressed via session GUC
                          ▼
                       offer/confirmation digests + expire-offers
                       naturally skip cancelled bookings
```

Display reads `show_dates.status` + `show_dates.cancellation_reason` directly.

## Components

### 1. Schema — `show_dates.cancellation_reason`
New migration: `ALTER TABLE public.show_dates ADD COLUMN cancellation_reason text;` (nullable, no
default). Regenerate `types.ts`. No RLS change (inherits `show_dates` policies).

### 2. Field-map extension
Add three logical keys to the field map (flat `app_settings.airtable_field_map`):
- `status_field` — Airtable field name of the Status single-select.
- `cancelled_value` — the option string that means cancelled (e.g. `"Cancelled"`).
- `cancellation_reason_field` — Airtable field name of the reason text.

Extend both mirrors: `AirtableFieldMap` + `SHOWFLOW_FIELDS`
([airtableMapping.ts:5](../../../src/data/airtableMapping.ts)) and the edge `FieldMap`
([airtable-poll/index.ts:12](../../../supabase/functions/airtable-poll/index.ts)). All three are
**optional** — never added to the required-fields guard, so orgs that don't use cancellation are
unaffected.

### 3. Sync logic (`airtable-poll`)
Per record, after existing field extraction:
```ts
const cancelledValue = (fieldMap.cancelled_value ?? "").trim().toLowerCase();
const statusRaw = fieldMap.status_field ? fields[fieldMap.status_field] ?? null : null;
const isCancelled = cancelledValue !== "" &&
  String(statusRaw ?? "").trim().toLowerCase() === cancelledValue;        // normalize case/space
const reason = fieldMap.cancellation_reason_field
  ? (fields[fieldMap.cancellation_reason_field] ?? null) : null;
```
- **Update branch:** if `isCancelled` → `payload.status='cancelled'`,
  `payload.cancellation_reason = reason ? String(reason) : null`. Else if the existing row's status
  is `'cancelled'` (fetched: add `status` to the existing-rows select) → **revival**:
  `payload.status='open'`, `payload.cancellation_reason=null`.
- **Insert branch:** a brand-new date that arrives already-cancelled → set `status='cancelled'` +
  reason on insert.

**Revival semantics:** a revived date returns to `'open'` with no active bookings (they were
cancelled by the cascade and do not auto-revive). Re-opening offers is a separate action (note:
there is currently **no UI** to manually open an offer tier — tracked separately; out of scope
here). The next booking write recomputes status normally.

### 4. Cascade trigger (`show_dates` → `bookings`)
New `AFTER INSERT OR UPDATE` trigger on `show_dates`, firing
`WHEN NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'cancelled')`:
- Cancel the date's active bookings: `UPDATE bookings SET status='cancelled', cancelled_at=now(),
  cancellation_reason='date_cancelled' WHERE show_date_id = NEW.id AND status <> 'cancelled'`. This
  covers pending offers (`suggested`), `soft_booked`, and `confirmed` alike — all are re-surfaced to
  the artist (§6) and all stop generating offers/digests.
- **Suppress understudy promotion:** `promote_understudy_on_cancellation` would otherwise promote an
  understudy onto the dead date. Reuse the GUC pattern that function already uses for its own
  re-entrancy guard (`app.promoting_understudy`,
  [20260519000000:68,211](../../../supabase/migrations/20260519000000_promote_understudy_on_cancellation.sql)):
  the cascade sets `set_config('app.cancelling_show_date','1',true)`, and we add **one** early-return
  check to `promote_understudy_on_cancellation` — `IF current_setting('app.cancelling_show_date',
  true) = '1' THEN RETURN NEW` — so it no-ops during a date cancellation.
- Idempotent (already-cancelled bookings are excluded). Writes to `booking_audit_log` via the
  existing transition trigger — audit trail preserved.
- The `date_cancelled` reason doubles as the **display marker** for re-surfacing the entry to the
  released artist (see §6) — it cleanly distinguishes a date cancellation from a decline/expiry.
- `notify_booking_transition` fires on each cascade-cancellation, so each released artist also gets
  an in-app notification. (Verify volume during implementation; if too noisy, suppress it for the
  cascade via the same GUC, matching the existing `app.promoting_understudy` handling in
  [20260519010000](../../../supabase/migrations/20260519010000_patch_notify_booking_transition_guc.sql).)

### 5. Mapping UI (`AirtableSyncTab.tsx`)
In the existing **Field mapping** card ([AirtableSyncTab.tsx:298](../../../src/components/settings/AirtableSyncTab.tsx)),
after the `SHOWFLOW_FIELDS` block, add:
- **Status field** picker (reuse the `selectedTable.fields.map` Select pattern).
- **"Cancelled" value** picker — options from `optionNames(fieldMap.status_field)`
  ([AirtableSyncTab.tsx:106](../../../src/components/settings/AirtableSyncTab.tsx)).
- **Reason field** picker.
All persist via the existing `setField` draft path — no new persistence wiring.

### 6. Display
- **Bookings list** ([ShowsBookingsPage.tsx:351](../../../src/pages/ShowsBookingsPage.tsx)): extend
  the `'show_dates.status'` cell so that when `status==='cancelled'`, the reason renders beneath the
  badge (`text-xs text-destructive`). Add `cancellation_reason` to the list `select` + `ShowDateRow`.
- **Detail sheet** ([ShowDateDetailSheet.tsx:271](../../../src/components/shows/ShowDateDetailSheet.tsx)):
  a destructive `Alert` ("Cancelled — <reason>") after the date-info block, conditioned on
  `status==='cancelled'`. Add `cancellation_reason` to the detail `select`. Shared by producers and
  artists who open a cancelled entry.
- **Artist My Bookings** ([ArtistBookingsView.tsx:42](../../../src/components/bookings/ArtistBookingsView.tsx)):
  this list is eligibility-driven, and eligibility excludes cancelled dates; `myBookings` also
  filters out cancelled ([:59](../../../src/components/bookings/ArtistBookingsView.tsx)). So a
  cancelled date the artist was booked on currently vanishes on both counts. Add a **supplementary
  query** for the artist's date-cancelled bookings (`artist_id = me AND status='cancelled' AND
  cancellation_reason='date_cancelled'`, joined to the cancelled `show_date` for
  date/show/venue/sessions/reason) and **merge** those into the list + calendar, rendered with a
  destructive "Cancelled" badge and the reason. Introduce a `cancelled` value for the artist
  `_computed.my_status` cell (`STATUS_LABEL`/`STATUS_STYLE` at
  [:23-35](../../../src/components/bookings/ArtistBookingsView.tsx)). Opening one reuses the
  detail-sheet banner above.
  - **Inclusion rule:** any artist who had an **active** booking when the date was cancelled —
    a pending offer (`suggested`), `soft_booked`, or `confirmed` (understudies included). The cascade
    cancels them all with `cancellation_reason='date_cancelled'`, which is exactly the re-surface
    filter; a pending offer's entry thus transitions from "Offer pending" to "Cancelled" rather than
    disappearing.

## Testing strategy (test-first)

| Layer | Covers |
|---|---|
| **pgTAP** | Cascade trigger: cancelling a date cancels its active bookings with `date_cancelled`; understudies are **not** promoted; already-cancelled bookings untouched; `status='cancelled'` survives a subsequent booking write (invariant). Revival path resets to `open`. |
| **Edge (Deno)** | `airtable-poll` `handle()` via `makeFakeDeps`: Status==Cancelled → `status` + reason in payload; case/space normalization; revival when Airtable un-cancels; reason omitted when unmapped. |
| **pgTAP (RLS)** | A released artist (booking now `cancelled`) can still `SELECT` their own cancelled booking and the cancelled `show_date` (incl. `cancellation_reason`); a non-involved artist cannot. |
| **Vitest** | Field-map data layer (new keys round-trip); a pure `isCancelledStatus(raw, mappedValue)` helper (extracted, shared with the edge fn if practical); `ShowsBookingsPage` inline reason + `ShowDateDetailSheet` banner render when cancelled; **`ArtistBookingsView` shows a `date_cancelled` booking as a "Cancelled" entry with the reason (not hidden)**. |

## Non-goals (YAGNI)
- Re-surfacing cancelled dates in the artist **availability** calendar or dashboard — only **My
  Bookings** shows them, and only for artists who had a booking on the date.
- Showing a cancelled date to artists who only ever had cast *eligibility* but no booking on it.
- In-app editing of the cancellation reason (read-only mirror of Airtable).
- Auto re-opening offers on revival (separate; blocked on the missing open-offer-tier UI).
- Composite/multi-value cancellation logic, or multiple "cancelled-like" status values.

## Risks
- **Cascade + understudy suppression** is the delicate part — pgTAP-covered, GUC-guarded.
- **RLS for released artists.** After the cascade the artist's booking is `cancelled`; they must
  still read that booking row and the cancelled `show_date` (incl. `cancellation_reason`) for My
  Bookings to show it. Verify the existing `bookings` / `show_dates` policies already permit this
  (artist reads own bookings; org/eligibility read on the date) and adjust only if a cancelled date
  falls out of the artist's read scope. Covered by the pgTAP RLS test above.
- **Field-map mirrors** (frontend + edge) must stay in sync — existing project convention.
- **Reason as free text** from Airtable is rendered verbatim; React escapes it, so no injection risk.

## File touch-list
- `supabase/migrations/<new>_show_date_cancellation.sql` — column + cascade trigger + GUC guard on promotion.
- `src/integrations/supabase/types.ts` — regenerated.
- `src/data/airtableMapping.ts`, `supabase/functions/airtable-poll/index.ts` — field-map keys + sync logic.
- `src/components/settings/AirtableSyncTab.tsx` — 3 mapping controls.
- `src/pages/ShowsBookingsPage.tsx`, `src/components/shows/ShowDateDetailSheet.tsx` — producer display + selects.
- `src/components/bookings/ArtistBookingsView.tsx` (+ a supplementary query/hook) — artist cancelled-entry display.
- Tests co-located per layer.
