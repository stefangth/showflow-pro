# Schedule-change Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify every artist with an active booking on an Airtable-changed date — whole-date cancellation or per-session add/remove/retime — in-app and via the daily confirmation digest email.

**Architecture:** A DB trigger records schedule changes into a new `show_date_change_log` table; the daily `send-confirmation-digest` cron coalesces undigested rows, resolves recipients per change type, creates in-app `schedule_change` notifications, folds the changes into an adaptive digest email, and stamps the rows consumed. `airtable-poll` is fixed to clear removed sessions; `session_1` becomes nullable with the ≥1-session rule enforced at `open-offer-tier`.

**Tech Stack:** Supabase Postgres (plpgsql triggers, RLS), Deno edge functions (DI via `Deps`), React Email templates, React + TypeScript frontend.

---

## Environment & how to run tests (READ FIRST)

The maintainer's machine is **Deno-only**. Run things accordingly:

- **Deno tests (Tasks 1, 3, 4, 5, 6)** — run locally:
  `deno test --allow-all --node-modules-dir=none supabase/functions/<path>`
- **`deno check` (Task 6)** — type-checks a `.tsx` locally:
  `deno check supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`
- **Migration / trigger behavior (Task 2)** — there is **no local Postgres**. Validate by pasting the migration + probe SQL into a **single Supabase MCP `execute_sql` call wrapped in `BEGIN … ROLLBACK`** (nothing persists). The pgTAP file runs in **CI** (`supabase test db`). This BEGIN…ROLLBACK check is how the #107 `42P17` trigger bug was caught — do not skip it.
- **pgTAP, Vitest, `tsc --noEmit` (Tasks 2, 7)** — **CI only**. Write the files; CI is the gate.

Commit after every task. Branch is already `claude/crazy-chandrasekhar-3d441f`.

---

## File Structure

**Create:**
- `supabase/functions/_shared/scheduleChanges.ts` — pure helpers: classify a session diff, coalesce change-log rows into net per-date summaries, format human labels, pick the digest email subject. No I/O. Imported by the digest and the email template.
- `supabase/functions/_shared/scheduleChanges.test.ts` — Deno unit tests for the above.
- `supabase/migrations/20260620140000_schedule_change_notifications.sql` — `session_1` nullable; `show_date_change_log` table + RLS + indexes; `log_show_date_schedule_change` trigger.
- `supabase/tests/triggers/log_show_date_schedule_change.sql` — pgTAP for the trigger + nullable session_1.

**Modify:**
- `supabase/functions/airtable-poll/index.ts` — write all *mapped* session slots (null clears a removed session); drop the insert `00:00` fabrication.
- `supabase/functions/airtable-poll/index.test.ts` — add session-sync cases.
- `supabase/functions/open-offer-tier/index.ts` — select session columns; benign-skip when a date has zero sessions.
- `supabase/functions/open-offer-tier/index.test.ts` — add the zero-session guard test (via real `handle()`).
- `supabase/functions/send-confirmation-digest/index.ts` — fold the change log (query, coalesce, recipients, in-app notifications, adaptive email payload, stamp).
- `supabase/functions/send-confirmation-digest/index.test.ts` — replace the old inline-logic tests with real `handle()` tests.
- `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx` — adaptive subject/heading + Schedule changes / Cancelled sections + previewData.
- `src/integrations/supabase/types.ts` — `session_1` nullable; add `show_date_change_log`.
- `src/pages/AvailabilityPage.tsx`, `src/pages/ShowsBookingsPage.tsx` — `session_1` null-guards.

---

## Task 1: Pure schedule-change helpers

**Files:**
- Create: `supabase/functions/_shared/scheduleChanges.ts`
- Test: `supabase/functions/_shared/scheduleChanges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/scheduleChanges.test.ts`:

```ts
import { assertEquals } from "./test-asserts.ts";
import {
  classifySessionChange,
  coalesceChangeRows,
  describeDateChanges,
  digestEmailSubject,
  fmtTime,
  type ChangeLogRow,
} from "./scheduleChanges.ts";

const row = (o: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: o.id ?? "r", show_date_id: o.show_date_id ?? "d1",
  change_type: o.change_type ?? "session_retimed", session_slot: o.session_slot ?? 1,
  old_value: o.old_value ?? null, new_value: o.new_value ?? null,
  created_at: o.created_at ?? "2026-06-01T10:00:00Z",
});

Deno.test("classifySessionChange covers add / remove / retime / no-op", () => {
  assertEquals(classifySessionChange(null, "19:00:00"), "session_added");
  assertEquals(classifySessionChange("19:00:00", null), "session_removed");
  assertEquals(classifySessionChange("19:00:00", "20:00:00"), "session_retimed");
  assertEquals(classifySessionChange("19:00:00", "19:00:00"), null);
  assertEquals(classifySessionChange(null, null), null);
});

Deno.test("fmtTime trims seconds and handles null", () => {
  assertEquals(fmtTime("19:00:00"), "19:00");
  assertEquals(fmtTime(null), "—");
});

Deno.test("coalesce: a cancelled row wins and drops session noise", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", change_type: "session_retimed", session_slot: 1, old_value: "19:00:00", new_value: "20:00:00" }),
    row({ show_date_id: "d1", change_type: "cancelled", session_slot: null }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].cancelled, true);
  assertEquals(out[0].sessions, []);
});

Deno.test("coalesce: per-slot net = earliest old + latest new", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", session_slot: 2, old_value: "15:00:00", new_value: "16:00:00", created_at: "2026-06-01T10:00:00Z" }),
    row({ show_date_id: "d1", session_slot: 2, old_value: "16:00:00", new_value: "17:00:00", created_at: "2026-06-01T14:00:00Z" }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].sessions, [{ slot: 2, kind: "session_retimed", old: "15:00:00", new: "17:00:00" }]);
});

Deno.test("coalesce: a reverted slot self-cancels (net no-op dropped)", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", session_slot: 3, change_type: "session_added", old_value: null, new_value: "19:00:00", created_at: "2026-06-01T10:00:00Z" }),
    row({ show_date_id: "d1", session_slot: 3, change_type: "session_removed", old_value: "19:00:00", new_value: null, created_at: "2026-06-01T14:00:00Z" }),
  ]);
  assertEquals(out, []);
});

Deno.test("describeDateChanges renders a human summary", () => {
  assertEquals(
    describeDateChanges({ showDateId: "d1", cancelled: false, sessions: [
      { slot: 2, kind: "session_retimed", old: "15:00:00", new: "17:00:00" },
      { slot: 3, kind: "session_added", old: null, new: "19:00:00" },
    ] }),
    "Session 2 now 17:00 (was 15:00); Session 3 added (19:00)",
  );
  assertEquals(describeDateChanges({ showDateId: "d1", cancelled: true, sessions: [] }), "Date cancelled");
});

Deno.test("digestEmailSubject is neutral when changes/cancellations are present", () => {
  assertEquals(digestEmailSubject({ bookings: [{}], scheduleChanges: [], cancellations: [] }),
    "Your bookings are confirmed — Showflow Pro");
  assertEquals(digestEmailSubject({ scheduleChanges: [{}] }), "Your booking updates — Showflow Pro");
  assertEquals(digestEmailSubject({ cancellations: [{}] }), "Your booking updates — Showflow Pro");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/scheduleChanges.test.ts`
Expected: FAIL — `Module not found "./scheduleChanges.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/scheduleChanges.ts`:

```ts
/** Pure helpers for schedule-change detection/coalescing, shared by the
 *  confirmation digest and the digest email template. No I/O. */

export type SessionChangeKind = "session_added" | "session_removed" | "session_retimed";

export interface ChangeLogRow {
  id: string;
  show_date_id: string;
  change_type: "cancelled" | SessionChangeKind;
  session_slot: number | null;
  old_value: string | null; // 'HH:MM[:SS]' or null
  new_value: string | null;
  created_at: string; // ISO; used only for ordering
}

export interface CoalescedSession {
  slot: number;
  kind: SessionChangeKind;
  old: string | null;
  new: string | null;
}

export interface CoalescedDateChange {
  showDateId: string;
  cancelled: boolean;
  sessions: CoalescedSession[];
}

/** Classify one slot's old→new transition; null when unchanged. */
export function classifySessionChange(oldVal: string | null, newVal: string | null): SessionChangeKind | null {
  if (oldVal === newVal) return null;
  if (oldVal === null) return "session_added";
  if (newVal === null) return "session_removed";
  return "session_retimed";
}

/** 'HH:MM:SS' | 'HH:MM' → 'HH:MM'; null → '—'. */
export function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : "—";
}

/** Coalesce many change-log rows into one net summary per show_date:
 *  - any 'cancelled' row makes the date cancelled (session noise dropped);
 *  - otherwise, per slot, net = earliest old + latest new (a reverted slot drops). */
export function coalesceChangeRows(rows: ChangeLogRow[]): CoalescedDateChange[] {
  const byDate = new Map<string, ChangeLogRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.show_date_id);
    if (list) list.push(r); else byDate.set(r.show_date_id, [r]);
  }

  const out: CoalescedDateChange[] = [];
  for (const [showDateId, dateRows] of byDate) {
    if (dateRows.some((r) => r.change_type === "cancelled")) {
      out.push({ showDateId, cancelled: true, sessions: [] });
      continue;
    }
    const bySlot = new Map<number, ChangeLogRow[]>();
    for (const r of dateRows) {
      if (r.session_slot == null) continue;
      const list = bySlot.get(r.session_slot);
      if (list) list.push(r); else bySlot.set(r.session_slot, [r]);
    }
    const sessions: CoalescedSession[] = [];
    for (const [slot, slotRows] of bySlot) {
      const ordered = [...slotRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const oldVal = ordered[0].old_value;
      const newVal = ordered[ordered.length - 1].new_value;
      const kind = classifySessionChange(oldVal, newVal);
      if (kind === null) continue; // net no-op
      sessions.push({ slot, kind, old: oldVal, new: newVal });
    }
    if (sessions.length === 0) continue;
    sessions.sort((a, b) => a.slot - b.slot);
    out.push({ showDateId, cancelled: false, sessions });
  }
  return out;
}

/** Human one-liner for one slot change. */
export function describeSessionChange(s: CoalescedSession): string {
  const label = `Session ${s.slot}`;
  if (s.kind === "session_added") return `${label} added (${fmtTime(s.new)})`;
  if (s.kind === "session_removed") return `${label} removed`;
  return `${label} now ${fmtTime(s.new)} (was ${fmtTime(s.old)})`;
}

/** Human summary for a whole date's coalesced change. */
export function describeDateChanges(c: CoalescedDateChange): string {
  if (c.cancelled) return "Date cancelled";
  return c.sessions.map(describeSessionChange).join("; ");
}

/** Adaptive digest subject: neutral when the email carries more than confirmations. */
export function digestEmailSubject(data: { scheduleChanges?: unknown[]; cancellations?: unknown[] }): string {
  const hasUpdates = (data.scheduleChanges?.length ?? 0) > 0 || (data.cancellations?.length ?? 0) > 0;
  return hasUpdates ? "Your booking updates — Showflow Pro" : "Your bookings are confirmed — Showflow Pro";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/scheduleChanges.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/scheduleChanges.ts supabase/functions/_shared/scheduleChanges.test.ts
git commit -m "feat(notifications): pure schedule-change coalescing helpers"
```

---

## Task 2: DB migration — nullable session_1, change-log table + trigger

**Files:**
- Create: `supabase/migrations/20260620140000_schedule_change_notifications.sql`
- Create: `supabase/tests/triggers/log_show_date_schedule_change.sql`
- Modify: `src/integrations/supabase/types.ts:1152,1170,1188` + add a table block

- [ ] **Step 1: Write the pgTAP test (runs in CI)**

Create `supabase/tests/triggers/log_show_date_schedule_change.sql`:

```sql
-- Tests for log_show_date_schedule_change (migration 20260620140000):
--   * session add / remove / retime each log one row with the right type/slot/values
--   * a transition to cancelled logs exactly one 'cancelled' row (no session noise)
--   * a fill-state status change (open→partially_filled) logs nothing
--   * a no-op update and a revival (cancelled→open) log nothing
--   * session_1 accepts NULL (incl. an all-null-sessions row)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-0c10-0001-0000-000000000000', 'theatre', 'musical', 1, 1, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0c10-0001-0000-000000000000', 'cccccccc-0c10-0001-0000-000000000000', '2099-09-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

-- 1. session_2 added (null → time)
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_2 = '20:00'::time WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 1, 'session add logs one row');
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_added', 'add → session_added');
SELECT is((SELECT session_slot FROM public.show_date_change_log), 2::smallint, 'add → slot 2');

-- 2. session_1 retimed
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_1 = '18:30'::time WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_retimed', 'change → session_retimed');

-- 3. session_1 removed (time → null)  [session_1 is now nullable]
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_1 = NULL WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT change_type FROM public.show_date_change_log), 'session_removed', 'null → session_removed');

-- 4. cancellation: one 'cancelled' row, no session rows even when sessions change too
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'cancelled', session_2 = NULL WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 1, 'cancellation logs exactly one row');
SELECT is((SELECT change_type FROM public.show_date_change_log), 'cancelled', 'cancellation → cancelled row');

-- 5. revival cancelled→open logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'open' WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'revival logs nothing');

-- 6. fill-state status change logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET status = 'partially_filled' WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'fill-state status change logs nothing');

-- 7. no-op update logs nothing
DELETE FROM public.show_date_change_log;
UPDATE public.show_dates SET session_3 = session_3 WHERE id = 'dddddddd-0c10-0001-0000-000000000000';
SELECT is((SELECT count(*)::int FROM public.show_date_change_log), 0, 'no-op update logs nothing');

-- 8. session_1 nullable: an all-null-sessions show_date inserts fine
SELECT lives_ok($$
  INSERT INTO public.show_dates (id, show_id, date, org_id)
  VALUES ('dddddddd-0c10-0002-0000-000000000000', 'cccccccc-0c10-0001-0000-000000000000', '2099-09-02', '00000000-0000-0000-0000-00000000b007')
$$, 'show_date with all-null sessions inserts (session_1 nullable)');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260620140000_schedule_change_notifications.sql`:

```sql
-- Schedule-change notifications — DB foundation.
--   (1) session_1 becomes nullable: the schedule may reshuffle freely (e.g. clear
--       session_1 while session_3 exists). The "≥1 session" rule is enforced at the
--       offer pipeline (open-offer-tier), NOT a DB CHECK, so the Airtable sync can
--       always mirror a legitimate times-TBD (zero-session) date.
--   (2) show_date_change_log records what changed on a show_date so the daily
--       confirmation digest can notify the date's booked artists.
--   (3) log_show_date_schedule_change writes those rows.
--
-- No GUC is needed here. The #107 cascade (cascade_cancel_bookings_on_date_cancel)
-- updates BOOKINGS, not show_dates, so this show_dates trigger fires exactly once per
-- Airtable write. Fill-state status writes (open/partially_filled/fully_filled) from
-- the bookings recompute trigger are filtered out by the WHEN clause. This is an
-- UPDATE-only trigger, so its WHEN clause MAY reference OLD (unlike the combined
-- INSERT/UPDATE cascade trigger, which triggers Postgres 42P17 if it does).

-- (1) ---------------------------------------------------------------------------
ALTER TABLE public.show_dates ALTER COLUMN session_1 DROP NOT NULL;

-- (2) ---------------------------------------------------------------------------
CREATE TABLE public.show_date_change_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id)    ON DELETE CASCADE,
  change_type  text NOT NULL CHECK (change_type IN ('cancelled','session_added','session_removed','session_retimed')),
  session_slot smallint CHECK (session_slot IN (1,2,3)),
  old_value    text,
  new_value    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  digested_at  timestamptz
);
COMMENT ON TABLE public.show_date_change_log IS
  'Append-only log of schedule changes (cancellation / per-session add/remove/retime) on a show_date, consumed by send-confirmation-digest. digested_at stamps when the change was notified.';

CREATE INDEX idx_show_date_change_log_undigested
  ON public.show_date_change_log (org_id, digested_at) WHERE digested_at IS NULL;
CREATE INDEX idx_show_date_change_log_show_date
  ON public.show_date_change_log (show_date_id);

ALTER TABLE public.show_date_change_log ENABLE ROW LEVEL SECURITY;

-- Writes happen only via the SECURITY DEFINER trigger and the service-role digest
-- (both bypass RLS), so there is no authenticated INSERT/UPDATE/DELETE policy.
CREATE POLICY org_isolation ON public.show_date_change_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can view show_date_change_log"
  ON public.show_date_change_log FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

-- (3) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_show_date_schedule_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Transition INTO cancelled → record only the cancellation (the whole date is dead;
  -- per-session noise is irrelevant to a released artist).
  IF NEW.status = 'cancelled'::show_date_status
     AND OLD.status IS DISTINCT FROM 'cancelled'::show_date_status THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type)
    VALUES (NEW.org_id, NEW.id, 'cancelled');
    RETURN NULL;
  END IF;

  -- Already cancelled (or staying cancelled) → no active bookings to notify.
  IF NEW.status = 'cancelled'::show_date_status THEN
    RETURN NULL;
  END IF;

  -- Per-session diffs (only a real value change emits a row).
  IF NEW.session_1 IS DISTINCT FROM OLD.session_1 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_1 IS NULL THEN 'session_added'
           WHEN NEW.session_1 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      1, OLD.session_1::text, NEW.session_1::text);
  END IF;
  IF NEW.session_2 IS DISTINCT FROM OLD.session_2 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_2 IS NULL THEN 'session_added'
           WHEN NEW.session_2 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      2, OLD.session_2::text, NEW.session_2::text);
  END IF;
  IF NEW.session_3 IS DISTINCT FROM OLD.session_3 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_3 IS NULL THEN 'session_added'
           WHEN NEW.session_3 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      3, OLD.session_3::text, NEW.session_3::text);
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS log_show_date_schedule_change ON public.show_dates;
CREATE TRIGGER log_show_date_schedule_change
AFTER UPDATE OF session_1, session_2, session_3, status ON public.show_dates
FOR EACH ROW
WHEN (
  (OLD.status = 'cancelled'::show_date_status) IS DISTINCT FROM (NEW.status = 'cancelled'::show_date_status)
  OR OLD.session_1 IS DISTINCT FROM NEW.session_1
  OR OLD.session_2 IS DISTINCT FROM NEW.session_2
  OR OLD.session_3 IS DISTINCT FROM NEW.session_3
)
EXECUTE FUNCTION public.log_show_date_schedule_change();
```

- [ ] **Step 3: Validate against the live DB via the Supabase MCP (local gate for the migration)**

Use the Supabase MCP `execute_sql` tool with the **entire migration above, then the probe block below, wrapped in one `BEGIN … ROLLBACK`** (nothing persists; this catches `42P17` and verifies trigger behavior):

```sql
BEGIN;
-- <paste the full migration body here>

-- probe: add a session, then cancel, on a scratch date
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-0cff-0001-0000-000000000000','theatre','musical',1,1,'00000000-0000-0000-0000-00000000b007');
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0cff-0001-0000-000000000000','cccccccc-0cff-0001-0000-000000000000','2099-09-01','19:00'::time,'00000000-0000-0000-0000-00000000b007');
UPDATE public.show_dates SET session_2='20:00'::time WHERE id='dddddddd-0cff-0001-0000-000000000000';
UPDATE public.show_dates SET status='cancelled', session_2=NULL WHERE id='dddddddd-0cff-0001-0000-000000000000';
SELECT change_type, session_slot FROM public.show_date_change_log ORDER BY created_at;
ROLLBACK;
```

Expected: the DDL applies with no error, and the final SELECT returns exactly two rows — `('session_added', 2)` then `('cancelled', NULL)`. If `42P17` or any error appears, fix the migration before continuing.

- [ ] **Step 4: Hand-edit `src/integrations/supabase/types.ts`**

Make `session_1` nullable (three lines):
- Line ~1152 (Row): `session_1: string` → `session_1: string | null`
- Line ~1170 (Insert): `session_1: string` → `session_1?: string | null`
- Line ~1188 (Update): `session_1?: string` → `session_1?: string | null`

Add this table entry to the `public.Tables` object (alphabetically just after `show_date_cast_eligibility`):

```ts
      show_date_change_log: {
        Row: {
          change_type: string
          created_at: string
          digested_at: string | null
          id: string
          new_value: string | null
          old_value: string | null
          org_id: string
          session_slot: number | null
          show_date_id: string
        }
        Insert: {
          change_type: string
          created_at?: string
          digested_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          org_id: string
          session_slot?: number | null
          show_date_id: string
        }
        Update: {
          change_type?: string
          created_at?: string
          digested_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          org_id?: string
          session_slot?: number | null
          show_date_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "show_date_change_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_date_change_log_show_date_id_fkey"
            columns: ["show_date_id"]
            isOneToOne: false
            referencedRelation: "show_dates"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260620140000_schedule_change_notifications.sql \
        supabase/tests/triggers/log_show_date_schedule_change.sql \
        src/integrations/supabase/types.ts
git commit -m "feat(notifications): change-log table, trigger, nullable session_1"
```

---

## Task 3: airtable-poll — fully sync sessions (clear removed, no 00:00)

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts:201-203,212-216,234-237`
- Test: `supabase/functions/airtable-poll/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/airtable-poll/index.test.ts` (the `seededDepsWithExisting`, `captureShowDateUpdates`, `authReq`, `airtableResponse`, and `ORG` helpers already exist in this file):

```ts
const SESSION_FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City", session_1: "S1", session_2: "S2", session_3: "S3" };

/** Wrap deps.admin.from so every show_dates INSERT payload is captured. */
function captureShowDateInserts(deps: ReturnType<typeof makeFakeDeps>["deps"]): unknown[] {
  const inserts: unknown[] = [];
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        inserts.push(payload);
        const insertChain = (originalInsert as (x: unknown) => any)(payload);
        (insertChain as any).single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  };
  return inserts;
}

Deno.test("airtable-poll sessions: a mapped-but-emptied session clears the column to null", async () => {
  // Existing date; Airtable keeps S1 but clears S2 (was set). The UPDATE must write session_2: null.
  const records = [{ id: "rec-x", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", S1: "19:00" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "rec-x", id: "sd-x", status: "open" }, SESSION_FIELD_MAP);
  const updates = captureShowDateUpdates(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const payload = updates[0] as Record<string, unknown>;
  assertEquals(payload.session_1, "19:00");
  assertEquals(payload.session_2, null); // mapped slot, empty Airtable cell → cleared
  assertEquals(payload.session_3, null);
});

Deno.test("airtable-poll sessions: a brand-new date with no S1 inserts session_1 null (no 00:00 fabrication)", async () => {
  const records = [{ id: "rec-new", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "other", id: "sd-other", status: "open" }, SESSION_FIELD_MAP);
  const inserts = captureShowDateInserts(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const payload = inserts[0] as Record<string, unknown>;
  assertEquals(payload.session_1, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.test.ts`
Expected: FAIL — the new cases see `session_2` absent from the payload (current code skips nulls) and `session_1` = `"00:00"`.

- [ ] **Step 3: Edit the UPDATE branch (sessions)**

In `supabase/functions/airtable-poll/index.ts`, the UPDATE branch currently writes the three sessions gated on non-null (skipping removals):

```ts
        if (session1 !== null) payload.session_1 = session1;
        if (session2 !== null) payload.session_2 = session2;
        if (session3 !== null) payload.session_3 = session3;
```

Replace **those three lines only** (leave the `const payload = { date: dateValue }` line above and the `if (venue !== null) …` / `city_id` / `custom` / cancellation lines below untouched) with — write every MAPPED slot, null included, so an emptied Airtable field clears a removed session:

```ts
        if (fieldMap.session_1) payload.session_1 = session1;
        if (fieldMap.session_2) payload.session_2 = session2;
        if (fieldMap.session_3) payload.session_3 = session3;
```

- [ ] **Step 4: Edit the INSERT branch (sessions)**

The INSERT branch currently fabricates a `00:00` session_1 in the object literal and writes session_2/3 gated on non-null:

```ts
      const insertPayload: Record<string, unknown> = { show_id: showId, date: dateValue, airtable_record_id: id, city_id: cityId, session_1: session1 ?? "00:00" };
      if (session2 !== null) insertPayload.session_2 = session2;
      if (session3 !== null) insertPayload.session_3 = session3;
```

Replace **those three lines** (leave the `if (venue !== null) …` / `custom` / cancellation lines below untouched) with — drop the `00:00` fallback (session_1 is nullable now) and write every mapped slot:

```ts
      const insertPayload: Record<string, unknown> = { show_id: showId, date: dateValue, airtable_record_id: id, city_id: cityId };
      if (fieldMap.session_1) insertPayload.session_1 = session1;
      if (fieldMap.session_2) insertPayload.session_2 = session2;
      if (fieldMap.session_3) insertPayload.session_3 = session3;
```

- [ ] **Step 5: Run the whole airtable-poll suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.test.ts`
Expected: PASS (the two new tests plus all pre-existing ones, including the cancellation cases).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.test.ts
git commit -m "fix(airtable-poll): clear removed sessions; drop 00:00 fabrication"
```

---

## Task 4: open-offer-tier — ≥1-session benign skip

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts:29-36`
- Test: `supabase/functions/open-offer-tier/index.test.ts`

- [ ] **Step 1: Write the failing test (real `handle()`)**

Append to `supabase/functions/open-offer-tier/index.test.ts`:

```ts
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

function svcReq(body: unknown) {
  return makeRequest({ headers: { Authorization: "Bearer svc-key" }, body });
}

Deno.test("zero-session date is a benign skip — no offers opened", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: { SUPABASE_SERVICE_ROLE_KEY: "svc-key" },
    tables: {
      show_dates: { data: { id: "sd1", show_id: "s1", city_id: "c1", date: "2026-06-01", status: "open", session_1: null, session_2: null, session_3: null }, error: null },
    },
  });
  const res = await handle(svcReq({ show_date_id: "sd1", tier: 1 }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertEquals(body.message, "Show date has no sessions yet — offers not opened");
  // No bookings were inserted.
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

Deno.test("date with a session passes the session gate", async () => {
  const { deps } = makeFakeDeps({
    envVars: { SUPABASE_SERVICE_ROLE_KEY: "svc-key" },
    tables: {
      show_dates: { data: { id: "sd1", show_id: "s1", city_id: "c1", date: "2026-06-01", status: "open", session_1: "19:00:00", session_2: null, session_3: null }, error: null },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(svcReq({ show_date_id: "sd1", tier: 1 }), deps);
  const body = await res.json();
  // Past the session gate; stops later for lack of priority casts (different message).
  assertEquals(body.message !== "Show date has no sessions yet — offers not opened", true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/index.test.ts`
Expected: FAIL — first test currently proceeds past the (missing) gate; `message` is not the no-sessions string.

- [ ] **Step 3: Edit the handler**

In `supabase/functions/open-offer-tier/index.ts`, change the select (line 30-33) to include sessions:

```ts
  const { data: showDate, error: sdErr } = await admin
    .from('show_dates')
    .select('id, show_id, city_id, date, status, session_1, session_2, session_3')
    .eq('id', show_date_id)
    .maybeSingle()
```

Then immediately after the cancelled check (line 36), add the gate:

```ts
  if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400)
  if (!showDate.session_1 && !showDate.session_2 && !showDate.session_3) {
    // ≥1-session rule: a times-TBD date is not yet bookable. Benign skip (200, not
    // 400) so airtable-poll's batch caller does not log a false "offer-tier failed".
    return json({ offers_created: 0, message: 'Show date has no sessions yet — offers not opened' })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/index.test.ts`
Expected: PASS (both new tests + the existing ones).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/open-offer-tier/index.ts supabase/functions/open-offer-tier/index.test.ts
git commit -m "feat(open-offer-tier): skip dates with no sessions yet"
```

---

## Task 5: send-confirmation-digest — fold schedule changes

**Files:**
- Modify: `supabase/functions/send-confirmation-digest/index.ts` (full rewrite of the per-org body)
- Test: `supabase/functions/send-confirmation-digest/index.test.ts` (replace file)

- [ ] **Step 1: Replace the test file with real `handle()` tests**

Overwrite `supabase/functions/send-confirmation-digest/index.test.ts`:

```ts
/**
 * Contract tests for send-confirmation-digest — exercises the REAL handle():
 * confirmations + schedule changes folded into one per-artist email, in-app
 * notifications for registered artists, and change-log stamping.
 *
 * now = 2026-06-01T18:00:00Z → Berlin 20:00 → matches the default
 * confirmation_digest_hour_berlin (20), so the org processes.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000d1";
const NOW = new Date("2026-06-01T18:00:00Z");
const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": "secret123" } });

// Two registered artists. A: a new confirmation + a session change. B: a cancellation.
const A_USER = "aaaa1111-0000-0000-0000-000000000000";
const B_USER = "bbbb2222-0000-0000-0000-000000000000";

function digestDeps() {
  return makeFakeDeps({
    now: NOW,
    tables: {
      app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }],
      organizations: { data: [{ id: ORG }], error: null },
      bookings: [
        // confirmations query (.eq status=confirmed)
        { when: { status: "confirmed" }, data: [
          { id: "bk-conf-A", artist_id: "art-A", artists: { id: "art-A", name: "Ada", email: "ada@ex.com", user_id: A_USER },
            show_dates: { date: "2026-06-10", shows: { program: "Magic", sub_program: null }, cities: { name: "Berlin" } } },
        ] },
        // change-recipient query (.in show_date_id) — fallback (no `when`)
        { data: [
          { id: "bk-A2", artist_id: "art-A", show_date_id: "sd-change", status: "confirmed", cancellation_reason: null,
            artists: { id: "art-A", name: "Ada", email: "ada@ex.com", user_id: A_USER } },
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-1", show_date_id: "sd-change", change_type: "session_retimed", session_slot: 1, old_value: "19:00:00", new_value: "20:00:00", created_at: "2026-06-01T10:00:00Z",
          show_dates: { date: "2026-06-12", status: "open", cancellation_reason: null, shows: { program: "Magic", sub_program: null }, cities: { name: "Berlin" } } },
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: "Venue flooded", shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [
      { user_id: A_USER, email: "ada@login.com", display_name: "Ada L" },
      { user_id: B_USER, email: "ben@login.com", display_name: "Ben L" },
    ], error: null } },
  });
}

Deno.test("folds confirmations + schedule changes into one email per artist", async () => {
  const { deps, invokeCalls, calls } = digestDeps();
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);

  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 2);

  const aEmail = emails.find((e) => (e.body as any).recipient_email === "ada@login.com")!.body as any;
  assertEquals(aEmail.templateData.bookings.length, 1); // the confirmation
  assertEquals(aEmail.templateData.scheduleChanges.length, 1); // the retime
  assertEquals(aEmail.templateData.scheduleChanges[0].changes, "Session 1 now 20:00 (was 19:00)");
  assertEquals(aEmail.templateData.cancellations.length, 0);

  const bEmail = emails.find((e) => (e.body as any).recipient_email === "ben@login.com")!.body as any;
  assertEquals(bEmail.templateData.bookings.length, 0);
  assertEquals(bEmail.templateData.cancellations.length, 1);
  assertEquals(bEmail.templateData.cancellations[0].reason, "Venue flooded");

  // In-app notifications inserted for both registered artists.
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(!!notifInsert, true);
  const rows = (notifInsert!.args[0] as any[]);
  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.type === "schedule_change"), true);

  // Change-log rows stamped digested.
  const stamped = calls.some((c) => c.table === "show_date_change_log" && c.method === "update");
  assertEquals(stamped, true);
});

Deno.test("an org with only schedule changes (no confirmations) is still processed", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    now: NOW,
    tables: {
      app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }],
      organizations: { data: [{ id: ORG }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [] },
        { data: [
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: null, shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: B_USER, email: "ben@login.com", display_name: "Ben L" }], error: null } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as any).recipient_email, "ben@login.com");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-confirmation-digest/index.test.ts`
Expected: FAIL — the current handler ignores `show_date_change_log` (no `scheduleChanges`/`cancellations`, no notifications, no stamp), and skips the changes-only org.

- [ ] **Step 3: Rewrite the handler**

Overwrite `supabase/functions/send-confirmation-digest/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
import { coalesceChangeRows, describeDateChanges, type ChangeLogRow } from "../_shared/scheduleChanges.ts";

const ACTIVE_BOOKING_STATUSES = ["suggested", "soft_booked", "confirmed"];

/**
 * Daily confirmation digest (hourly cron). For each ACTIVE org whose
 * confirmation_digest_hour_berlin matches the current Berlin hour, send one email
 * per artist that folds BOTH newly-confirmed bookings AND undigested schedule
 * changes (cancellation / per-session add/remove/retime) on dates the artist is
 * booked on, creating in-app schedule_change notifications for registered artists.
 * In-app delivery happens before the (best-effort) email; change-log rows are
 * stamped digested afterwards so they are not re-processed.
 * Auth: X-Cron-Secret (pg_cron) or admin/producer JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  const now = deps.now();
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(now),
    10,
  ) % 24;

  let orgs: Array<{ id: string }>;
  try {
    orgs = await getActiveOrgs(admin);
  } catch (e) {
    console.error('send-confirmation-digest: failed to fetch active orgs', { error: (e as Error).message });
    return json({ error: 'failed to fetch active orgs' }, 500);
  }
  let digestsSent = 0;
  const processedOrgs: string[] = [];

  for (const org of orgs) {
    let targetHour: number;
    try {
      targetHour = await resolveOrgSetting<number>(admin, org.id, 'confirmation_digest_hour_berlin', 20);
    } catch (e) {
      console.error('send-confirmation-digest: settings read failed', { org: org.id, error: (e as Error).message });
      continue;
    }
    if (berlinHour !== targetHour) continue;
    processedOrgs.push(org.id);

    // ── Source 1: newly-confirmed bookings ──
    const { data: confirmedRaw, error: queryErr } = await admin
      .from('bookings')
      .select(`
        id,
        artist_id,
        artists ( id, name, email, user_id ),
        show_dates ( date, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .eq('status', 'confirmed')
      .is('confirmation_digest_sent_at', null);
    if (queryErr) { console.error('send-confirmation-digest: query error', { org: org.id, error: queryErr.message }); continue; }

    // ── Source 2: undigested schedule changes ──
    const { data: changeRaw, error: changeErr } = await admin
      .from('show_date_change_log')
      .select(`
        id, show_date_id, change_type, session_slot, old_value, new_value, created_at,
        show_dates ( date, status, cancellation_reason, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .is('digested_at', null);
    if (changeErr) { console.error('send-confirmation-digest: change-log query error', { org: org.id, error: changeErr.message }); continue; }

    const confirmed = (confirmedRaw ?? []) as any[];
    const changeRows = (changeRaw ?? []) as any[];
    if (confirmed.length === 0 && changeRows.length === 0) continue;

    // Show context per show_date (every row for a date joins to its current row).
    const dateContext = new Map<string, { show: string; date: string; city: string; reason: string | null }>();
    for (const r of changeRows) {
      const sd = r.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      dateContext.set(r.show_date_id, { show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—', reason: sd?.cancellation_reason ?? null });
    }

    const coalesced = coalesceChangeRows(changeRows.map((r): ChangeLogRow => ({
      id: r.id, show_date_id: r.show_date_id, change_type: r.change_type,
      session_slot: r.session_slot, old_value: r.old_value, new_value: r.new_value, created_at: r.created_at,
    })));

    // Recipients per affected date (one bookings query, partitioned in JS).
    const affectedDateIds = coalesced.map((c) => c.showDateId);
    let changeBookings: any[] = [];
    if (affectedDateIds.length > 0) {
      const { data } = await admin
        .from('bookings')
        .select('id, artist_id, show_date_id, status, cancellation_reason, artists ( id, name, email, user_id )')
        .eq('org_id', org.id)
        .in('show_date_id', affectedDateIds);
      changeBookings = (data ?? []) as any[];
    }
    const bookingsByDate = new Map<string, any[]>();
    for (const b of changeBookings) {
      const list = bookingsByDate.get(b.show_date_id);
      if (list) list.push(b); else bookingsByDate.set(b.show_date_id, [b]);
    }

    // ── ADR-0011: resolve login-first contacts for every artist across BOTH sources ──
    const userIds = [...new Set([
      ...confirmed.map((b) => b.artists?.user_id),
      ...changeBookings.map((b) => b.artists?.user_id),
    ].filter((id: unknown): id is string => !!id))];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) console.error('send-confirmation-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      else for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
    }

    type GroupedEntry = {
      recipientEmail: string; displayName: string;
      bookingIds: string[];
      bookings: Array<{ show: string; date: string; city: string }>;
      scheduleChanges: Array<{ show: string; date: string; city: string; changes: string }>;
      cancellations: Array<{ show: string; date: string; city: string; reason: string | null }>;
    };
    const grouped = new Map<string, GroupedEntry>();
    const ensureEntry = (artistId: string, artist: any): GroupedEntry | null => {
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) return null;
      let entry = grouped.get(artistId);
      if (!entry) {
        entry = {
          recipientEmail,
          displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }),
          bookingIds: [], bookings: [], scheduleChanges: [], cancellations: [],
        };
        grouped.set(artistId, entry);
      }
      return entry;
    };

    // Confirmations
    for (const b of confirmed) {
      const entry = ensureEntry(b.artist_id, b.artists);
      if (!entry) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      entry.bookingIds.push(b.id);
      entry.bookings.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—' });
    }

    // Schedule changes + in-app notifications
    const notificationRows: any[] = [];
    for (const c of coalesced) {
      const ctx = dateContext.get(c.showDateId) ?? { show: 'Unknown show', date: '—', city: '—', reason: null };
      const dateBookings = bookingsByDate.get(c.showDateId) ?? [];
      const recipients = c.cancelled
        ? dateBookings.filter((b) => b.status === 'cancelled' && b.cancellation_reason === 'date_cancelled')
        : dateBookings.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));
      for (const b of recipients) {
        const entry = ensureEntry(b.artist_id, b.artists);
        if (entry) {
          if (c.cancelled) entry.cancellations.push({ show: ctx.show, date: ctx.date, city: ctx.city, reason: ctx.reason });
          else entry.scheduleChanges.push({ show: ctx.show, date: ctx.date, city: ctx.city, changes: describeDateChanges(c) });
        }
        // In-app for registered artists only (the reliable channel — created before email).
        if (b.artists?.user_id) {
          notificationRows.push({
            org_id: org.id,
            user_id: b.artists.user_id,
            type: 'schedule_change',
            title: c.cancelled ? 'Booking cancelled' : 'Schedule change',
            message: c.cancelled
              ? `Your booking for ${ctx.show} on ${ctx.date} was cancelled.`
              : `${ctx.show} on ${ctx.date}: ${describeDateChanges(c)}`,
            related_entity_type: 'show_date',
            related_entity_id: c.showDateId,
          });
        }
      }
    }
    if (notificationRows.length > 0) {
      const { error: notifErr } = await admin.from('notifications').insert(notificationRows);
      if (notifErr) console.error('send-confirmation-digest: notification insert failed', { org: org.id, error: notifErr.message });
    }

    // One email per artist (confirmations + schedule changes folded). Best-effort.
    for (const [artistId, entry] of grouped) {
      try {
        await deps.sendEmail({
          template_name: 'artist-confirmation-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: {
            displayName: entry.displayName,
            bookings: entry.bookings,
            scheduleChanges: entry.scheduleChanges,
            cancellations: entry.cancellations,
          },
          idempotency_key: `confirmation-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        if (entry.bookingIds.length > 0) {
          const { error: stampErr } = await admin
            .from('bookings')
            .update({ confirmation_digest_sent_at: now.toISOString() })
            .in('id', entry.bookingIds);
          if (stampErr) console.error('send-confirmation-digest: stamp failed', { org: org.id, artistId, error: stampErr.message });
        }
        digestsSent += 1;
      } catch (e) {
        console.error('send-confirmation-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }

    // Stamp every consumed change-log row (incl. net-no-op ones) so they don't linger.
    const consumedChangeIds = changeRows.map((r) => r.id);
    if (consumedChangeIds.length > 0) {
      const { error: digestStampErr } = await admin
        .from('show_date_change_log')
        .update({ digested_at: now.toISOString() })
        .in('id', consumedChangeIds);
      if (digestStampErr) console.error('send-confirmation-digest: change-log stamp failed', { org: org.id, error: digestStampErr.message });
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has confirmation digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-confirmation-digest/index.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full edge suite (no regressions)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS across all functions.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-confirmation-digest/index.ts supabase/functions/send-confirmation-digest/index.test.ts
git commit -m "feat(digest): fold schedule changes into confirmation digest"
```

---

## Task 6: Adaptive digest email template

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`

- [ ] **Step 1: Edit the template**

Overwrite `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`:

```tsx
/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { digestEmailSubject } from '../scheduleChanges.ts'

const SITE_NAME = 'Showflow Pro'

interface BookingRow { show: string; date: string; city: string }
interface ChangeRow { show: string; date: string; city: string; changes: string }
interface CancelRow { show: string; date: string; city: string; reason?: string | null }

interface Props {
  displayName?: string
  bookings?: BookingRow[]
  scheduleChanges?: ChangeRow[]
  cancellations?: CancelRow[]
  _intro?: string
  _footer?: string
}

const ArtistConfirmationDigest = ({ displayName, bookings = [], scheduleChanges = [], cancellations = [], _intro, _footer }: Props) => {
  const hasUpdates = scheduleChanges.length > 0 || cancellations.length > 0
  const heading = hasUpdates ? 'Your booking updates' : 'Your bookings are confirmed'
  const introText = _intro || (hasUpdates
    ? `Here's what changed on your bookings.`
    : `Here's what just got confirmed. We're excited to have you on stage!`)
  const footerText = _footer || `— The ${SITE_NAME} team`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{heading} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{displayName ? `Hi ${displayName},` : 'Hi,'}</Text>
          <Text style={text}>{introText}</Text>

          {cancellations.length > 0 && (
            <Section style={tableSection}>
              <Text style={sectionLabel}>Cancelled</Text>
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th><th style={th}>Reason</th></tr>
                </thead>
                <tbody>
                  {cancellations.map((c, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{c.show}</td><td style={td}>{c.date}</td><td style={td}>{c.city}</td><td style={td}>{c.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {scheduleChanges.length > 0 && (
            <Section style={tableSection}>
              <Text style={sectionLabel}>Schedule changes</Text>
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th><th style={th}>Change</th></tr>
                </thead>
                <tbody>
                  {scheduleChanges.map((c, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{c.show}</td><td style={td}>{c.date}</td><td style={td}>{c.city}</td><td style={td}>{c.changes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {bookings.length > 0 && (
            <Section style={tableSection}>
              {hasUpdates && <Text style={sectionLabel}>Confirmed</Text>}
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th></tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{b.show}</td><td style={td}>{b.date}</td><td style={td}>{b.city}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {bookings.length === 0 && !hasUpdates && (
            <Text style={{ ...text, color: '#64748b' }}>No confirmed bookings yet.</Text>
          )}

          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ArtistConfirmationDigest,
  subject: (data: Record<string, any>) => digestEmailSubject(data),
  displayName: 'Artist confirmation digest',
  previewData: {
    displayName: 'Jane Performer',
    bookings: [{ show: 'Riverdance', date: '2026-06-15', city: 'Berlin' }],
    scheduleChanges: [{ show: 'Riverdance', date: '2026-06-22', city: 'Hamburg', changes: 'Session 1 now 20:00 (was 19:00)' }],
    cancellations: [{ show: 'Riverdance', date: '2026-06-29', city: 'Munich', reason: 'Venue flooded' }],
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }
const h1 = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 16px',
  fontFamily: '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
}
const text = { fontSize: '15px', color: '#334155', lineHeight: 1.6, margin: '0 0 16px' }
const tableSection = { margin: '24px 0' }
const sectionLabel: React.CSSProperties = { fontSize: '13px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '14px' }
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #e2e8f0',
  color: '#64748b',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
}
const tr: React.CSSProperties = {}
const trAlt: React.CSSProperties = { backgroundColor: '#f8fafc' }
const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  color: '#0f172a',
  verticalAlign: 'top',
}
const footer = { fontSize: '13px', color: '#64748b', margin: '32px 0 0' }
```

- [ ] **Step 2: Type-check the template locally**

Run: `deno check supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`
Expected: no type errors. (The subject-selection logic is already unit-tested via `digestEmailSubject` in Task 1; the JSX render is validated by CI / the preview function.)

- [ ] **Step 3: Re-run the digest test (payload still satisfied by the template contract)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-confirmation-digest/index.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx
git commit -m "feat(email): adaptive confirmation digest with changes/cancelled sections"
```

---

## Task 7: Frontend session_1 null-guards

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx:256`
- Modify: `src/pages/ShowsBookingsPage.tsx:328`

> Verified by CI `tsc --noEmit` (once `types.ts` marks `session_1` nullable, the unguarded `.slice()` is a compile error) — not runnable on the Deno-only machine. Match the existing inline guard pattern already used in `ArtistBookingsView.tsx:178`.

- [ ] **Step 1: Guard AvailabilityPage**

In `src/pages/AvailabilityPage.tsx`, line 256, replace:

```tsx
                        <TableCell key={colId} className="whitespace-nowrap">{d.session_1.slice(0, 5)}</TableCell>
```

with:

```tsx
                        <TableCell key={colId} className="whitespace-nowrap">{d.session_1 ? d.session_1.slice(0, 5) : '—'}</TableCell>
```

- [ ] **Step 2: Guard ShowsBookingsPage**

In `src/pages/ShowsBookingsPage.tsx`, line 328, replace:

```tsx
                        <TableCell key={colId} className="whitespace-nowrap">{sd.session_1.slice(0, 5)}</TableCell>
```

with:

```tsx
                        <TableCell key={colId} className="whitespace-nowrap">{sd.session_1 ? sd.session_1.slice(0, 5) : '—'}</TableCell>
```

- [ ] **Step 3: Sanity-check no other unguarded `.session_1.` access remains**

Run: `grep -rn "session_1\.slice\|session_1\.\|\.session_1\b" src --include=*.tsx --include=*.ts | grep -v "session_1 ?" | grep -v "session_1:" | grep -v "'show_dates.session_1'"`
Expected: only guarded usages (`d.session_1 ? …`) or non-value references remain; if a new unguarded `.slice` shows up, guard it the same way.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AvailabilityPage.tsx src/pages/ShowsBookingsPage.tsx
git commit -m "fix(ui): guard nullable session_1 in availability and bookings tables"
```

---

## Final verification (CI gates)

These run in CI on push; list them in the PR description as the test plan:

- **Deno** — `deno test --allow-all --node-modules-dir=none supabase/functions/` (all green locally before push).
- **pgTAP** — `supabase test db` includes `triggers/log_show_date_schedule_change.sql`.
- **Vitest** — `npx vitest run` (no frontend logic changed beyond guards; existing suites stay green).
- **tsc** — `npx tsc --noEmit` validates `types.ts` (session_1 nullable, new table) and the two page guards.
- **Manual smoke** — map session fields in Settings → Airtable; in Airtable: clear a session on a booked date and cancel another booked date; at the org's digest hour confirm each booked artist gets one digest email (Schedule changes / Cancelled sections) + an in-app notification, and that `show_date_change_log.digested_at` is stamped.
```
