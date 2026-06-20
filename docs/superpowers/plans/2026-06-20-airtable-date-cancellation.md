# Airtable-driven date cancellation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an Airtable date's Status = "Cancelled", mark the `show_date` cancelled, import the reason, release the booked artists, and surface the cancellation (with reason) to producers and to any artist who had a booking.

**Architecture:** Inbound-only. `airtable-poll` writes `show_dates.status='cancelled'` + a new `cancellation_reason` column; a DB cascade trigger releases that date's bookings (understudy-promotion suppressed via a session GUC). The `cancelled` status is durable because `compute_show_date_status` short-circuits on it. UI reads the two columns directly.

**Tech Stack:** Postgres (Supabase migrations + pgTAP), Deno edge function (`airtable-poll`), React 18 + TS + React Query, Vitest.

**Spec:** [`docs/superpowers/specs/2026-06-20-airtable-date-cancellation-design.md`](../specs/2026-06-20-airtable-date-cancellation-design.md)

### Execution environment note (read first)
This workstation has **Deno only** — no Node, npm, or Supabase CLI. Therefore:
- **Deno tests** (`deno test …`) run locally — true red/green loop.
- **pgTAP** (`supabase test db`) and **Vitest** (`npx vitest run`) run **in CI** (`.github/workflows/ci.yml`). For those, "verify it fails/passes" means push the branch and read the `db-tests` / `unit-tests` / `typecheck` jobs. Write the test first regardless.
- `types.ts` is hand-edited to match the migration (no local CLI to regenerate); the surgical add is identical to what regeneration produces and is validated by the `typecheck` job.
- **Commits:** this repo holds commits until the user asks. Each task lists a commit step; batch or defer per the user's instruction at execution time.

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `supabase/migrations/20260620130000_show_date_cancellation.sql` | `cancellation_reason` column + cascade trigger + GUC guard on promotion | New |
| `supabase/tests/show_date_cancellation.test.sql` | pgTAP: cascade, invariant, revival, RLS | New |
| `src/integrations/supabase/types.ts` | regenerated row type for `show_dates.cancellation_reason` | Mod |
| `supabase/functions/_shared/airtableStatus.ts` | pure `isCancelledStatus()` | New |
| `supabase/functions/_shared/airtableStatus.test.ts` | Deno test for the helper | New |
| `src/data/airtableMapping.ts` | `AirtableFieldMap` + `SHOWFLOW_FIELDS` new keys | Mod |
| `supabase/functions/airtable-poll/index.ts` | `FieldMap` keys + cancel/revival sync logic | Mod |
| `supabase/functions/airtable-poll/index.test.ts` | Deno test: cancel sets status+reason; revival | Mod |
| `src/components/settings/AirtableSyncTab.tsx` | 3 mapping controls | Mod |
| `src/pages/ShowsBookingsPage.tsx` | producer inline reason + select/type | Mod |
| `src/components/shows/ShowDateDetailSheet.tsx` | cancelled banner + select | Mod |
| `src/data/artists.ts` (or `src/data/bookings.ts`) | `fetchMyCancelledDateBookings()` + pure merge helper | Mod |
| `src/components/bookings/ArtistBookingsView.tsx` | re-surface cancelled entries | Mod |

---

## Task 1: Schema — `show_dates.cancellation_reason` column

**Files:**
- Create: `supabase/migrations/20260620130000_show_date_cancellation.sql`
- Test: `supabase/tests/show_date_cancellation.test.sql`

- [ ] **Step 1: Write the failing pgTAP test (column exists)**

Create `supabase/tests/show_date_cancellation.test.sql`. Match the setup/fixture conventions used by existing files in `supabase/tests/` (how they seed an org/show/show_date). Start with:

```sql
begin;
select plan(1);

select has_column('public', 'show_dates', 'cancellation_reason',
  'show_dates has a cancellation_reason column');

select * from finish();
rollback;
```

- [ ] **Step 2: Verify it fails (CI)**

Push branch; read the `db-tests` job. Expected: FAIL — `column "cancellation_reason" does not exist`.

- [ ] **Step 3: Create the migration with the column**

Create `supabase/migrations/20260620130000_show_date_cancellation.sql`:

```sql
-- Date-level cancellation, driven by Airtable (Status single-select = "Cancelled").
-- See docs/superpowers/specs/2026-06-20-airtable-date-cancellation-design.md

-- 1) Reason column (distinct from bookings.cancellation_reason, which is a per-booking code).
ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

COMMENT ON COLUMN public.show_dates.cancellation_reason IS
  'Date-level cancellation reason, synced from Airtable when the mapped Status = Cancelled.';
```

- [ ] **Step 4: Verify it passes (CI)** — `db-tests` job green for this assertion.

- [ ] **Step 5: Regenerate types (hand-edit, no local CLI)**

In `src/integrations/supabase/types.ts`, in the `show_dates` table block, add `cancellation_reason` to **Row**, **Insert**, and **Update** (alphabetical position, after `airtable_record_id`/before `city_id` — match the existing ordering). Row: `cancellation_reason: string | null`; Insert/Update: `cancellation_reason?: string | null`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260620130000_show_date_cancellation.sql supabase/tests/show_date_cancellation.test.sql src/integrations/supabase/types.ts
git commit -m "feat(cancellation): add show_dates.cancellation_reason column"
```

---

## Task 2: Cascade trigger + understudy-promotion guard

**Files:**
- Modify: `supabase/migrations/20260620130000_show_date_cancellation.sql` (append)
- Test: `supabase/tests/show_date_cancellation.test.sql` (extend)

- [ ] **Step 1: Write the failing pgTAP tests (cascade behavior)**

Extend the test file (bump `plan(1)` to cover the new assertions). Using the file's fixture helpers, set up: a show_date with `main_cast_slots`/`understudy_slots` configured; a **confirmed main** booking (artist A), a **soft_booked understudy** booking (artist B), and a **suggested** booking (artist C). Then:

```sql
-- Cancel the date.
update public.show_dates set status = 'cancelled' where id = :show_date_id;

-- All three bookings are now cancelled with reason 'date_cancelled'.
select is(
  (select count(*) from public.bookings
     where show_date_id = :show_date_id and status = 'cancelled'
       and cancellation_reason = 'date_cancelled'),
  3::bigint, 'cascade cancels all active bookings as date_cancelled');

-- The understudy (B) was NOT promoted (still cancelled, still understudy).
select is(
  (select status::text from public.bookings where id = :booking_b),
  'cancelled', 'understudy not promoted during date cancellation');

-- Invariant: a later booking write does not un-cancel the date.
update public.bookings set notes = 'x' where id = :booking_a;
select is(
  (select status::text from public.show_dates where id = :show_date_id),
  'cancelled', 'cancelled status sticks after a booking write');
```

- [ ] **Step 2: Verify it fails (CI)** — `db-tests` FAIL (bookings stay active; or understudy promoted).

- [ ] **Step 3: Append the cascade function + trigger to the migration**

Append to `supabase/migrations/20260620130000_show_date_cancellation.sql`:

```sql
-- 2) Cascade: when a date becomes cancelled, release its bookings. Suppress understudy
--    auto-promotion via a session GUC (mirrors the app.promoting_understudy guard).
CREATE OR REPLACE FUNCTION public.cascade_cancel_bookings_on_date_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.cancelling_show_date', 'true', true);

  UPDATE public.bookings
  SET status              = 'cancelled'::booking_status,
      cancelled_at        = now(),
      cancellation_reason = 'date_cancelled',
      updated_at          = now()
  WHERE show_date_id = NEW.id
    AND status <> 'cancelled'::booking_status;

  PERFORM set_config('app.cancelling_show_date', '', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cascade_cancel_bookings_on_date_cancel ON public.show_dates;
CREATE TRIGGER cascade_cancel_bookings_on_date_cancel
AFTER INSERT OR UPDATE OF status ON public.show_dates
FOR EACH ROW
WHEN (
  NEW.status = 'cancelled'::show_date_status
  AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled'::show_date_status)
)
EXECUTE FUNCTION public.cascade_cancel_bookings_on_date_cancel();
```

- [ ] **Step 4: Append the promotion guard to the migration**

Still in the same migration, `CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation()` using the **exact current body** from `supabase/migrations/20260604133000_org_scope_assignments_and_autocancel.sql` (the whole `CREATE OR REPLACE FUNCTION … AS $$ … $$;` block), changed in exactly one place: insert this guard **immediately after the `BEGIN`** (the function's first statement, before the `SELECT … INTO v_candidate`):

```sql
  -- A whole date is being cancelled (the understudy is being released too) — do not promote.
  IF current_setting('app.cancelling_show_date', true) = 'true' THEN
    RETURN NULL;
  END IF;
```

So the top of the function reads:

```sql
AS $$
DECLARE
  v_candidate        RECORD;
  v_new_status       booking_status;
  v_show_date        RECORD;
  v_producer_user_id UUID;
  v_notified         BOOLEAN := false;
BEGIN
  IF current_setting('app.cancelling_show_date', true) = 'true' THEN
    RETURN NULL;
  END IF;

  SELECT id, artist_id, status
  INTO v_candidate
  …  -- (rest of the existing body unchanged, verbatim)
```

> Copy the remaining lines verbatim from `20260604133000` — do not paraphrase. Reproducing a SECURITY DEFINER body by hand is error-prone, so diff the result against the source: it must be identical except for the 4 inserted lines above.

- [ ] **Step 5: Verify it passes (CI)** — `db-tests` green for all Task 2 assertions.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260620130000_show_date_cancellation.sql supabase/tests/show_date_cancellation.test.sql
git commit -m "feat(cancellation): cascade-cancel bookings when a date is cancelled"
```

---

## Task 3: RLS — a released artist can still read their cancelled booking + date

**Files:**
- Test: `supabase/tests/show_date_cancellation.test.sql` (extend)
- Possibly modify: `supabase/migrations/20260620130000_show_date_cancellation.sql` (only if the test fails)

- [ ] **Step 1: Write the failing/guard pgTAP test**

Extend the test: as the released artist's role (set `request.jwt.claims` / `role` the way other RLS tests in `supabase/tests/` do), assert they can still see the row:

```sql
-- Acting as artist A (user_id of the released, now-cancelled booking):
select is(
  (select count(*) from public.show_dates where id = :show_date_id), 1::bigint,
  'released artist can still read the cancelled show_date');
select is(
  (select count(*) from public.bookings
     where show_date_id = :show_date_id and artist_id = :artist_a), 1::bigint,
  'released artist can still read their own cancelled booking');
```

- [ ] **Step 2: Run in CI**

If both already pass (existing policies likely allow an artist to read their own bookings and org/eligible show_dates), **no migration change is needed** — record that the policies already cover it and skip Step 3.

- [ ] **Step 3: (Only if a test failed) add the minimal policy**

If the released artist cannot read the cancelled date/booking, append a narrowly-scoped SELECT policy to the migration permitting an artist to read a `show_date` for which they have any `bookings` row, and to read their own `bookings` rows regardless of status. Re-run CI until green. (Do not broaden beyond own-rows.)

- [ ] **Step 4: Commit** (only if changed)

```bash
git add supabase/migrations/20260620130000_show_date_cancellation.sql supabase/tests/show_date_cancellation.test.sql
git commit -m "test(cancellation): RLS read access for released artists"
```

---

## Task 4: Pure helper — `isCancelledStatus`

**Files:**
- Create: `supabase/functions/_shared/airtableStatus.ts`
- Test: `supabase/functions/_shared/airtableStatus.test.ts`

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/_shared/airtableStatus.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCancelledStatus } from "./airtableStatus.ts";

Deno.test("isCancelledStatus matches case- and space-insensitively", () => {
  assertEquals(isCancelledStatus("Cancelled", "Cancelled"), true);
  assertEquals(isCancelledStatus("  cancelled ", "Cancelled"), true);
  assertEquals(isCancelledStatus("CANCELLED", "cancelled"), true);
});

Deno.test("isCancelledStatus is false for non-matches and empty config", () => {
  assertEquals(isCancelledStatus("Confirmed", "Cancelled"), false);
  assertEquals(isCancelledStatus("Cancelled", ""), false);
  assertEquals(isCancelledStatus("Cancelled", null), false);
  assertEquals(isCancelledStatus(null, "Cancelled"), false);
  assertEquals(isCancelledStatus(undefined, "Cancelled"), false);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/airtableStatus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `supabase/functions/_shared/airtableStatus.ts`:

```ts
/** True when an Airtable Status value matches the configured "Cancelled" option,
 *  case- and whitespace-insensitively. Empty/null config or value → false. */
export function isCancelledStatus(
  raw: unknown,
  cancelledValue: string | null | undefined,
): boolean {
  const target = (cancelledValue ?? "").trim().toLowerCase();
  if (target === "") return false;
  return String(raw ?? "").trim().toLowerCase() === target;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/airtableStatus.test.ts`
Expected: PASS (5 assertions across 2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/airtableStatus.ts supabase/functions/_shared/airtableStatus.test.ts
git commit -m "feat(cancellation): isCancelledStatus helper"
```

---

## Task 5: Field-map keys (frontend + edge mirrors)

**Files:**
- Modify: `src/data/airtableMapping.ts:5-14`
- Modify: `supabase/functions/airtable-poll/index.ts:12-21`

- [ ] **Step 1: Extend `AirtableFieldMap`**

In `src/data/airtableMapping.ts`, add three keys to the interface (after `session_3`):

```ts
export interface AirtableFieldMap {
  date?: string | null;
  program?: string | null;
  sub_program?: string | null;
  city?: string | null;
  venue?: string | null;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
  /** Airtable single-select field name whose value signals cancellation. */
  status_field?: string | null;
  /** The option string on status_field that means "cancelled". */
  cancelled_value?: string | null;
  /** Airtable field name holding the cancellation reason text. */
  cancellation_reason_field?: string | null;
}
```

Leave `SHOWFLOW_FIELDS` unchanged — these three get bespoke controls (Task 7), not generic field rows.

- [ ] **Step 2: Mirror in the edge `FieldMap`**

In `supabase/functions/airtable-poll/index.ts`, add the same three keys to `interface FieldMap` (after `session_3`).

- [ ] **Step 3: Verify (CI typecheck)** — `typecheck` job green; nothing references missing keys yet.

- [ ] **Step 4: Commit**

```bash
git add src/data/airtableMapping.ts supabase/functions/airtable-poll/index.ts
git commit -m "feat(cancellation): add status/reason keys to the Airtable field map"
```

---

## Task 6: Sync logic in `airtable-poll`

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts` (existing-rows select ~142, per-record ~197, update ~200-214, insert ~216-228)
- Test: `supabase/functions/airtable-poll/index.test.ts`

- [ ] **Step 1: Write the failing Deno test**

Add to `supabase/functions/airtable-poll/index.test.ts` (follow the file's existing `makeFakeDeps`/handler pattern). Cover three cases against the fake admin client, asserting the `show_dates` UPDATE payload:
1. Mapped Status == cancelled value → payload has `status: 'cancelled'` and `cancellation_reason` from the reason field.
2. Status not cancelled, existing row currently `cancelled` → payload has `status: 'open'`, `cancellation_reason: null` (revival).
3. Status not cancelled, existing row not cancelled → payload has **no** `status` key.

```ts
// field map for the org under test:
// { date:'Date', sub_program:'Programme', status_field:'Status',
//   cancelled_value:'Cancelled', cancellation_reason_field:'Reason' }
// Assert on the captured update payload for the matching show_date_id.
```

- [ ] **Step 2: Run, verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.test.ts`
Expected: FAIL — payload lacks `status`/`cancellation_reason`.

- [ ] **Step 3: Implement — existing-rows select carries status**

Change the existing-rows query (currently `.select("id, airtable_record_id")`) and the map type. Replace the map declaration and population:

```ts
// was: const existingByAirtableId = new Map<string, string>();
const existingByAirtableId = new Map<string, { id: string; status: string }>();
```
```ts
const { data: batch } = await admin
  .from("show_dates").select("id, airtable_record_id, status")
  .eq("org_id", orgId).not("airtable_record_id", "is", null)
  .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
if (!batch || batch.length === 0) break;
for (const r of batch as Array<{ id: string; airtable_record_id: string | null; status: string }>) {
  if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id, { id: r.id, status: r.status });
}
```

- [ ] **Step 4: Implement — compute cancel/reason per record**

Add the import at the top: `import { isCancelledStatus } from "../_shared/airtableStatus.ts";`
After the `venue` line (~197) add:

```ts
const statusRaw = fieldMap.status_field ? fields[fieldMap.status_field] ?? null : null;
const isCancelled = isCancelledStatus(statusRaw, fieldMap.cancelled_value);
const reason = fieldMap.cancellation_reason_field
  ? (fields[fieldMap.cancellation_reason_field] ?? null) : null;
```

- [ ] **Step 5: Implement — update branch (cancel + revival)**

Replace the existing-row lookup and the update payload assembly:

```ts
const existing = existingByAirtableId.get(id);
const existingId = existing?.id;
if (existingId) {
  const payload: Record<string, unknown> = { date: dateValue };
  if (session1 !== null) payload.session_1 = session1;
  if (session2 !== null) payload.session_2 = session2;
  if (session3 !== null) payload.session_3 = session3;
  if (venue !== null) payload.venue = venue;
  if (cityId !== null) payload.city_id = cityId;
  const customBag = buildCustom(fields);
  if (customBag !== undefined) payload.custom = customBag;
  if (isCancelled) {
    payload.status = "cancelled";
    payload.cancellation_reason = reason == null ? null : String(reason);
  } else if (existing?.status === "cancelled") {
    payload.status = "open";            // revival: bookings were released; date starts fresh
    payload.cancellation_reason = null;
  }
  const { error } = await admin.from("show_dates").update(payload).eq("id", existingId);
  // …unchanged outcome handling…
```

- [ ] **Step 6: Implement — insert branch (new date arriving cancelled)**

After `if (customBagNew !== undefined) insertPayload.custom = customBagNew;` add:

```ts
if (isCancelled) {
  insertPayload.status = "cancelled";
  insertPayload.cancellation_reason = reason == null ? null : String(reason);
}
```
And update the post-insert map write to carry status:
```ts
existingByAirtableId.set(id, { id: inserted.id, status: isCancelled ? "cancelled" : "open" });
```

- [ ] **Step 7: Run, verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.test.ts
git commit -m "feat(cancellation): sync Airtable Status=Cancelled to show_dates + reason"
```

---

## Task 7: Mapping UI controls (`AirtableSyncTab`)

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx` (inside the Field-mapping card, after line 318)

- [ ] **Step 1: Add the three controls**

In the "Field mapping" `<CardContent>`, immediately after the `{SHOWFLOW_FIELDS.map(...)}` block and before `</CardContent>` (line ~318/319), insert:

```tsx
{/* Cancellation mapping (status → cancelled + reason) */}
<div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
  <Label>Status field (optional)</Label>
  <Select value={fieldMap.status_field ?? NONE} onValueChange={(v) => setField('status_field', v === NONE ? null : v)}>
    <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
    <SelectContent>
      <SelectItem value={NONE}>Not mapped</SelectItem>
      {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
{fieldMap.status_field && (
  <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
    <Label>"Cancelled" value</Label>
    <Select value={fieldMap.cancelled_value ?? NONE} onValueChange={(v) => setField('cancelled_value', v === NONE ? null : v)}>
      <SelectTrigger><SelectValue placeholder="Pick the cancelled option" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {optionNames(fieldMap.status_field).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
)}
<div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
  <Label>Cancellation reason (optional)</Label>
  <Select value={fieldMap.cancellation_reason_field ?? NONE} onValueChange={(v) => setField('cancellation_reason_field', v === NONE ? null : v)}>
    <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
    <SelectContent>
      <SelectItem value={NONE}>Not mapped</SelectItem>
      {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 2: Verify (CI typecheck + build)**

`typecheck` job green. (This is thin view wiring over the already-tested `isCancelledStatus` + sync logic and the typed `setField`; its end-to-end effect is covered by the Task 6 Deno test. No dedicated component test — the component's query/schema-state dependencies make an isolated render test high-cost/low-value. Verify visually via the running app at execution time.)

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx
git commit -m "feat(cancellation): map Status/Cancelled-value/Reason in Airtable settings"
```

---

## Task 8: Producer display — inline reason + detail banner

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx` (type ~41-55, select ~173, status cell ~351-357)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (select ~52-56, header ~271)

- [ ] **Step 1: ShowsBookingsPage — type + select**

Add to `ShowDateRow` (after `notes: string | null;`):
```ts
  cancellation_reason: string | null;
```
In the `show_dates` select (line ~173), add `cancellation_reason` to the column list:
```ts
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, custom, cancellation_reason,
```

- [ ] **Step 2: ShowsBookingsPage — inline reason under the status badge**

Replace the `'show_dates.status'` cell (lines ~351-357) with:
```tsx
case 'show_dates.status': return (
  <TableCell key={colId}>
    <Badge variant="secondary" className={STATUS_STYLE[status] ?? STATUS_STYLE.open}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
    {sd.status === 'cancelled' && sd.cancellation_reason && (
      <div className="mt-1 text-xs text-destructive">{sd.cancellation_reason}</div>
    )}
  </TableCell>
);
```
(Condition on raw `sd.status`, not `displayStatus`, so it's unaffected by the `unconfigured` UI override.)

- [ ] **Step 3: ShowDateDetailSheet — select + banner**

Add `cancellation_reason` to the detail `select` (line ~53, the `show_dates` field list). Then, immediately after the "Date info" `</div>` (line ~271) and before the "Slots summary" block (line ~273), add:
```tsx
{showDate.status === 'cancelled' && (
  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
    <p className="text-sm font-medium text-destructive">Cancelled</p>
    {showDate.cancellation_reason && (
      <p className="text-sm text-destructive/90 mt-0.5">{showDate.cancellation_reason}</p>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify (CI typecheck)** — `typecheck` green. (Presentational conditionals; the data path that populates `status`/`cancellation_reason` is covered by Task 6. Verify visually at execution.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/ShowsBookingsPage.tsx src/components/shows/ShowDateDetailSheet.tsx
git commit -m "feat(cancellation): show cancellation reason in producer list + detail sheet"
```

---

## Task 9: Artist data — fetch + merge cancelled-date bookings (testable logic)

**Files:**
- Modify: `src/data/artists.ts` (add `fetchMyCancelledDateBookings` + pure `mergeArtistCancelledDates`)
- Test: `src/data/artists.test.ts`

- [ ] **Step 1: Write the failing Vitest test**

Add to `src/data/artists.test.ts` (use the `supabaseFake` harness):

```ts
import { fetchMyCancelledDateBookings, mergeArtistCancelledDates } from "./artists";
import { createFakeSupabase } from "@/test/supabaseFake";

describe("fetchMyCancelledDateBookings", () => {
  it("selects this artist's date_cancelled bookings joined to the cancelled date", async () => {
    const row = {
      show_date_id: "d1",
      show_date: { id: "d1", date: "2026-07-01", venue: "Hall", session_1: "19:00:00",
        status: "cancelled", cancellation_reason: "Venue flooded",
        show: { program: "X", sub_program: null } },
    };
    const fake = createFakeSupabase({ bookings: { data: [row], error: null } });
    const res = await fetchMyCancelledDateBookings(fake as never, "a1");
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["artist_id", "a1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["cancellation_reason", "date_cancelled"] });
    expect(res[0].cancellation_reason).toBe("Venue flooded");
  });
});

describe("mergeArtistCancelledDates", () => {
  it("appends cancelled entries not already present among eligible dates", () => {
    const eligible = [{ id: "d2" } as any];
    const cancelled = [{ id: "d1", date: "2026-07-01", status: "cancelled" } as any];
    const merged = mergeArtistCancelledDates(eligible, cancelled);
    expect(merged.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });
  it("does not duplicate a date already in the eligible list", () => {
    const eligible = [{ id: "d1" } as any];
    const cancelled = [{ id: "d1", status: "cancelled" } as any];
    expect(mergeArtistCancelledDates(eligible, cancelled)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify it fails (CI `unit-tests`)** — functions not exported.

- [ ] **Step 3: Implement in `src/data/artists.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface CancelledDateEntry {
  id: string;            // show_date id
  date: string;
  venue: string | null;
  session_1: string | null;
  status: "cancelled";
  cancellation_reason: string | null;
  show: { program: string | null; sub_program: string | null } | null;
}

/** Dates this artist had a booking on that were cancelled by a date cancellation. */
export async function fetchMyCancelledDateBookings(
  client: SupabaseClient<Database>, artistId: string,
): Promise<CancelledDateEntry[]> {
  const { data, error } = await client
    .from("bookings")
    .select("show_date_id, show_date:show_dates(id, date, venue, session_1, status, cancellation_reason, show:shows(program, sub_program))")
    .eq("artist_id", artistId)
    .eq("status", "cancelled")
    .eq("cancellation_reason", "date_cancelled");
  if (error) throw error;
  return ((data ?? []) as any[])
    .map((b) => b.show_date)
    .filter((sd) => sd && sd.status === "cancelled") as CancelledDateEntry[];
}

/** Append cancelled entries whose id isn't already in the eligible-dates list. */
export function mergeArtistCancelledDates<T extends { id: string }>(
  eligible: T[], cancelled: CancelledDateEntry[],
): Array<T | CancelledDateEntry> {
  const seen = new Set(eligible.map((d) => d.id));
  return [...eligible, ...cancelled.filter((c) => !seen.has(c.id))];
}
```

- [ ] **Step 4: Verify it passes (CI `unit-tests`).**

- [ ] **Step 5: Commit**

```bash
git add src/data/artists.ts src/data/artists.test.ts
git commit -m "feat(cancellation): fetch + merge an artist's cancelled-date bookings"
```

---

## Task 10: Artist display — re-surface cancelled entries in My Bookings

**Files:**
- Modify: `src/components/bookings/ArtistBookingsView.tsx`

- [ ] **Step 1: Add the cancelled-status label/style + query**

Add to `STATUS_LABEL`/`STATUS_STYLE` (lines 23-35):
```ts
// STATUS_LABEL:
  cancelled: 'Cancelled',
// STATUS_STYLE:
  cancelled: 'bg-destructive/10 text-destructive',
```
Add the supplementary query (alongside `myBookings`), using Task 9's data fn:
```ts
import { fetchMyCancelledDateBookings } from '@/data/artists';
// …
const { data: cancelledEntries } = useQuery({
  queryKey: ['bookings', 'artist-cancelled', artist?.id],
  enabled: !!artist?.id,
  queryFn: () => fetchMyCancelledDateBookings(supabase, artist!.id),
});
```

- [ ] **Step 2: Merge cancelled entries into the list, render as Cancelled**

Build the merged list from `filtered` (eligible) plus cancelled entries via `mergeArtistCancelledDates`, and in `statusFor` return `'cancelled'` for cancelled entries (e.g., entries carrying `status === 'cancelled'`). Render the existing `_computed.my_status` badge — it now resolves to the `cancelled` style/label — and show `cancellation_reason` beneath the date/program cell for cancelled rows. Reuse the `EntityCalendar` path the same way. (Cancelled entries are display-only; clicking one opens `ShowDateDetailSheet`, which shows the banner from Task 8.)

- [ ] **Step 3: Verify (CI `typecheck` + `unit-tests`)**

The merge/fetch logic is covered by Task 9. `typecheck` green. Verify visually at execution that a cancelled date the artist was booked on appears as "Cancelled" with the reason and does not vanish.

- [ ] **Step 4: Commit**

```bash
git add src/components/bookings/ArtistBookingsView.tsx
git commit -m "feat(cancellation): show cancelled dates to booked artists in My Bookings"
```

---

## Self-review (completed by plan author)

**Spec coverage:** schema (T1), cascade + understudy suppression + invariant (T2), RLS for released artists (T3), helper (T4), field-map keys (T5), sync incl. revival (T6), mapping UI (T7), producer display (T8), artist data + display (T9-T10). All spec sections map to a task.

**Placeholder scan:** the migration filename and pgTAP fixture setup intentionally defer to existing `supabase/tests/` conventions (no local CLI to author them blind); all application code is concrete. No TODO/TBD in code steps.

**Type consistency:** `AirtableFieldMap`/`FieldMap` keys (`status_field`, `cancelled_value`, `cancellation_reason_field`) identical across frontend/edge; `isCancelledStatus(raw, cancelledValue)` signature consistent T4↔T6; `CancelledDateEntry`/`mergeArtistCancelledDates` consistent T9↔T10; `cancellation_reason` column/type consistent T1↔T6↔T8.

**Known test-depth trade-off:** core logic (helper, sync, cascade, RLS, artist data/merge) is unit/pgTAP-tested; thin presentational wiring (T7 controls, T8/T10 conditionals) is covered by `typecheck` + manual/visual verification rather than brittle full-page render tests — called out in each task.
