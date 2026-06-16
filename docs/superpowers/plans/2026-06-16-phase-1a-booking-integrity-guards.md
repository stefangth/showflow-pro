# Phase 1a — Booking Integrity Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two booking invariants DB-enforced — (1) at most one *active* (non-cancelled) booking per `(show_date, artist)`, and (2) a booking's artist must belong to the same org as its show_date.

**Architecture:** Two small additive migrations on the `bookings` table: a partial unique index, and a bookings-specific `BEFORE INSERT` derive-and-guard trigger function (the shared `derive_org_id_from_show_date_id()` stays for the other show_date children). Each is driven test-first with pgTAP. No frontend changes. This is the safe, independently-shippable slice of spec Phase 1; the `shows`-slot migration is Phase 1b (separate plan). Implements the integrity guards in [the sync-engine spec §5](../specs/2026-06-16-airtable-sync-engine-design.md) and [ADR-0001](../../adr/0001-airtable-system-of-record.md).

**Tech Stack:** PostgreSQL (Supabase, project `epweartpzwvcasrzyueh`), pgTAP. No local Supabase CLI/Docker in this environment — **apply DDL with the Supabase MCP `apply_migration`, run pgTAP with the Supabase MCP `execute_sql`** (the test files are `BEGIN … ROLLBACK`, so they leave no data). CI runs `supabase test db` on the committed files (`.github/workflows/ci.yml`).

---

## File Structure

- `supabase/migrations/20260616120000_bookings_active_unique.sql` — **new.** Partial unique index on `bookings(show_date_id, artist_id) WHERE status <> 'cancelled'`.
- `supabase/migrations/20260616120100_bookings_artist_org_guard.sql` — **new.** `derive_org_id_for_booking()` function + retarget the `trg_derive_org_id` trigger on `bookings`.
- `supabase/tests/db/bookings_active_unique.sql` — **new.** pgTAP for guard 1.
- `supabase/tests/db/bookings_artist_org_guard.sql` — **new.** pgTAP for guard 2.
- `CLAUDE.md` — **modify.** One line in the booking-rules section documenting the two guards.

Fixture UUIDs used across the tests (all valid hex): org A `11111111-…`, show `22222222-…`, show_date `33333333-…`, artist A `44444444-…`, booking `55555555-…`, org B `66666666-…`, artist B `77777777-…`.

---

### Task 1: Duplicate-active-booking guard (partial unique index)

**Files:**
- Create: `supabase/tests/db/bookings_active_unique.sql`
- Create: `supabase/migrations/20260616120000_bookings_active_unique.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/db/bookings_active_unique.sql`:

```sql
-- One active (non-cancelled) booking per (show_date, artist) is a DB guarantee.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-active-uniq');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Artist One', 'active');
INSERT INTO public.bookings (id, show_date_id, artist_id, status)
  VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested');

-- 1) a second ACTIVE booking for the same (show_date, artist) is rejected
SELECT throws_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'soft_booked') $$,
  '23505', NULL,
  'second active booking for same (show_date, artist) is rejected');

-- 2) a CANCELLED duplicate is allowed (partial index excludes cancelled)
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'cancelled') $$,
  'cancelled duplicate is allowed');

-- 3) after the active one is cancelled, a fresh active booking is allowed (re-offer)
UPDATE public.bookings SET status = 'cancelled' WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested') $$,
  're-offer after cancellation is allowed');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run via the Supabase MCP `execute_sql` (project `epweartpzwvcasrzyueh`) with the entire contents of `supabase/tests/db/bookings_active_unique.sql` as the `query`.
Expected: assertion 1 reports `not ok 1 - second active booking … is rejected` (no index yet, so the insert succeeds instead of throwing). Assertions 2 and 3 report `ok`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260616120000_bookings_active_unique.sql`:

```sql
-- At most one active (non-cancelled) booking per (show_date, artist).
-- The offer engine pre-filters duplicates in application code; this makes it a
-- race-safe DB guarantee. Partial on status<>'cancelled' so a declined-then-
-- re-offered artist still works (multiple cancelled rows are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_artist_date_uniq
  ON public.bookings (show_date_id, artist_id)
  WHERE status <> 'cancelled';
```

Apply it via the Supabase MCP `apply_migration` (project `epweartpzwvcasrzyueh`, name `bookings_active_unique`, `query` = the SQL above).

- [ ] **Step 4: Run the test and confirm it passes**

Run via `execute_sql` with the contents of `supabase/tests/db/bookings_active_unique.sql` again.
Expected: `ok 1`, `ok 2`, `ok 3` and a final `# Looks like you ran 3 tests` / no `not ok` lines.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260616120000_bookings_active_unique.sql supabase/tests/db/bookings_active_unique.sql
git commit -m "feat(db): guarantee one active booking per (show_date, artist)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Artist↔org consistency guard

**Files:**
- Create: `supabase/tests/db/bookings_artist_org_guard.sql`
- Create: `supabase/migrations/20260616120100_bookings_artist_org_guard.sql`

Context: today the `trg_derive_org_id` trigger on `bookings` runs the shared `derive_org_id_from_show_date_id()`, which only copies `org_id` from the show_date — nothing checks the artist's org. We give `bookings` a dedicated function that derives **and** guards; the shared function stays for `show_date_offer_tiers` / `show_date_cast_eligibility` / `chats`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/db/bookings_artist_org_guard.sql`:

```sql
-- A booking's artist must belong to the same org as its show_date.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

-- Org A: a show + date
INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-artist-guard');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
-- Same-org artist (positive case)
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Same Org Artist', 'active');
-- Org B: an artist that must NOT be bookable onto Org A's date
INSERT INTO public.organizations (id, name, slug)
  VALUES ('66666666-6666-6666-6666-666666666666', 'Org B', 'org-b-artist-guard');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Cross Org Artist', 'active');

-- 1) booking Org A's date with Org B's artist is rejected
SELECT throws_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', 'suggested') $$,
  'P0001', NULL,
  'booking an out-of-org artist is rejected');

-- 2) booking with a same-org artist succeeds
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested') $$,
  'booking a same-org artist succeeds');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run via `execute_sql` with the contents of `supabase/tests/db/bookings_artist_org_guard.sql`.
Expected: `not ok 1 - booking an out-of-org artist is rejected` (no guard yet — the insert succeeds, taking org_id from the show_date). Assertion 2 reports `ok`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260616120100_bookings_artist_org_guard.sql`:

```sql
-- Bookings derive org_id from their show_date AND must reference an artist in the
-- same org. The shared derive_org_id_from_show_date_id() is unchanged and still
-- serves the other show_date children (offer tiers, date eligibility, chats);
-- bookings get a dedicated derive-and-guard function.
CREATE OR REPLACE FUNCTION public.derive_org_id_for_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_org uuid;
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.show_dates WHERE id = NEW.show_date_id;
  SELECT org_id INTO v_artist_org FROM public.artists WHERE id = NEW.artist_id;
  IF v_artist_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'artist % (org %) does not belong to the booking''s org % (from show_date %)',
      NEW.artist_id, v_artist_org, NEW.org_id, NEW.show_date_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.bookings;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_booking();
```

Apply it via the Supabase MCP `apply_migration` (project `epweartpzwvcasrzyueh`, name `bookings_artist_org_guard`, `query` = the SQL above).

- [ ] **Step 4: Run the test and confirm it passes (+ no regression)**

Run via `execute_sql` with `supabase/tests/db/bookings_artist_org_guard.sql`.
Expected: `ok 1`, `ok 2`, no `not ok`.

Then re-run the existing invariant test to confirm bookings still derive org_id correctly: run via `execute_sql` with the contents of `supabase/tests/db/org_id_parent_child_consistency.sql`.
Expected: all `ok` (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260616120100_bookings_artist_org_guard.sql supabase/tests/db/bookings_artist_org_guard.sql
git commit -m "feat(db): reject bookings whose artist is in a different org than the show_date" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document the guards

**Files:**
- Modify: `CLAUDE.md` (the "Booking workflow (domain rules)" section)

- [ ] **Step 1: Add a line to the booking-rules section**

In `CLAUDE.md`, under `## Booking workflow (domain rules)`, immediately after the line
`A booking moves through: \`suggested → soft_booked → confirmed\` (or \`cancelled\` from any state).`
add:

```markdown

**DB-enforced integrity:** at most one *active* (non-cancelled) booking exists per `(show_date_id, artist_id)` (partial unique index `bookings_active_artist_date_uniq`); and a booking's artist must belong to the same org as its show_date (enforced by the `derive_org_id_for_booking()` BEFORE INSERT trigger). Do not rely on application-side dedup alone.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note the DB-enforced booking integrity guards" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Order matters:** Task 1's index before Task 2's trigger; both before Task 3.
- **Why `execute_sql` for tests:** the pgTAP files wrap everything in `BEGIN … ROLLBACK`, so running them via `execute_sql` against the live (greenfield, 0-booking) project leaves no residue. The same files are what CI runs via `supabase test db`.
- **No types regeneration needed** — neither migration changes a table's column set (`bookings` columns are unchanged), so `src/integrations/supabase/types.ts` is unaffected.
- If `apply_migration` reports a cost-confirmation prompt, that is expected for the first DDL of a session; confirm and proceed.
