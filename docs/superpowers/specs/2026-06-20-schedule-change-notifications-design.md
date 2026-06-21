# Schedule-change notifications — design

**Status:** Approved (brainstorming complete)
**Date:** 2026-06-20
**Author:** Stefan Schaal (with Claude)
**Related:** PR #107 (Airtable-driven date cancellation — the cascade trigger + GUC this builds on),
`docs/superpowers/specs/2026-06-20-airtable-date-cancellation-design.md` (reviewer follow-up #4:
"no notification today"), the sibling *reopen offer tier UI* task (coordinates on the ≥1-session gate).

## Context & goal

PR #107 made Airtable the source of truth for **date cancellation**: when a date's mapped Status =
"Cancelled", `airtable-poll` sets `show_dates.status='cancelled'` + `cancellation_reason`, and a DB
cascade (`cascade_cancel_bookings_on_date_cancel`) releases the date's bookings. **It deliberately
shipped with no notification** — a released artist only finds out by visiting *My Bookings*
(reviewer follow-up #4).

Separately, sessions (`show_dates.session_1/2/3`) sync from Airtable, but the sync only writes
**non-null** values today: it adds and retimes sessions but never **clears** one that was removed in
Airtable. And `session_1` is `NOT NULL`
([20260514140000_show_dates_replace_times_with_sessions.sql:13](../../../supabase/migrations/20260514140000_show_dates_replace_times_with_sessions.sql)),
so the schedule can't freely reshuffle (e.g. clear session_1 while session_3 exists).

**Goal:** one unified **schedule-change notification** mechanism. When an Airtable date changes —
**(1)** whole-date cancellation or **(2)** per-session add / remove / retime — notify **all active
bookings** (`suggested` / `soft_booked` / `confirmed`) on that date, delivered **in-app** *and* **by
email folded into the daily confirmation digest** (`send-confirmation-digest`). Unregistered artists
(no `user_id`) are reachable by email only.

## Decisions (locked in brainstorming)

1. **Sessions fully sync (add / remove / retime).** The gap to close is **removal**: `airtable-poll`
   must clear a `session_X` to `NULL` when the mapped Airtable field is emptied (today it skips nulls).
2. **`session_1` is no longer privileged** — made nullable so the schedule can reshuffle freely.
   "At least one session" is enforced at the **offer pipeline** (`open-offer-tier`), **not** a DB
   `CHECK`. Rationale: Airtable is the source of truth; a date with all session times cleared is a
   legitimate *times-TBD* state that the sync must be able to mirror faithfully. A hard `CHECK` would
   make the sync UPDATE fail on an all-empty row (keeping stale times and erroring the record). The
   business rule "a date isn't bookable until it has a time" belongs where bookings start.
3. **Recipients = all active bookings** on the date: `suggested`, `soft_booked`, `confirmed`
   (understudies included). Registered artists get an in-app notification + email; unregistered
   artists (no `user_id`) get email only.
4. **Email = the daily confirmation digest**, extended in place (not a separate immediate email). The
   template becomes **adaptive**: a neutral subject/heading ("Your booking updates") with
   **Confirmed / Schedule changes / Cancelled** sections, used whenever the email carries more than
   confirmations. An artist with only a cancellation never receives a "your bookings are confirmed"
   email.
5. **Change-detection mechanism = a `show_date_change_log` table written by a DB trigger on
   `show_dates`, consumed by the digest** (chosen over diffing against a stored snapshot at digest
   time: the table is an append-only audit trail and cleanly recovers *who* to notify for a
   cancellation even though the cascade has already cancelled their bookings by digest time).

## Architecture & data flow

```
Airtable record (Status single-select, Reason text, Session columns)
   │  every 5 min, per org
   ▼
airtable-poll
   • writes ALL mapped session slots, including null  ← closes the removal gap
     (drops the insert-branch session_1 ?? "00:00" fabrication)
   • status='cancelled' + reason when mapped Status = "Cancelled"; revival → status='open'
   ▼
UPDATE public.show_dates ──┬─▶ cascade_cancel_bookings_on_date_cancel  (existing, #107)
                           │      releases the date's active bookings (reason 'date_cancelled');
                           │      understudy promotion suppressed via app.cancelling_show_date GUC
                           │
                           └─▶ log_show_date_schedule_change  (NEW trigger)
                                  • cancel transition  → ONE 'cancelled' row (session noise skipped)
                                  • session add/remove/retime → one row per changed slot
                                  • fill-state status changes (open/partially_filled/fully_filled)
                                    and no-op updates → nothing
                                  ▼
                           public.show_date_change_log   (digested_at IS NULL = pending)
                                  │  once daily at confirmation_digest_hour_berlin (default 20:00)
                                  ▼
                           send-confirmation-digest  (extended)
                             • reads undigested change rows + new confirmations (skip org only if BOTH empty)
                             • coalesces change rows per (show_date, slot) → net diffs
                             • resolves recipients per change type:
                                 cancelled    → the date's released bookings (status='cancelled',
                                                cancellation_reason='date_cancelled')
                                 session chg  → the date's active bookings (suggested|soft_booked|confirmed)
                             • creates in-app `schedule_change` notifications (registered artists only)
                             • sends ONE adaptive digest email per artist (Confirmed / Schedule changes / Cancelled)
                             • stamps digested_at on consumed rows (+ existing confirmation_digest_sent_at)

open-offer-tier: refuses to open offers on a zero-session date (benign skip) — keeps a times-TBD
date un-bookable until ≥1 session exists.
```

## Components

### 1. Sessions fully sync + `session_1` nullable

**Migration** (`<ts>_schedule_change_notifications.sql`):
```sql
ALTER TABLE public.show_dates ALTER COLUMN session_1 DROP NOT NULL;
```
No `CHECK` constraint (decision 2).

**`airtable-poll/index.ts`** — replace the null-skipping session writes
([:201-203,213-215,235-237](../../../supabase/functions/airtable-poll/index.ts)). For every *mapped*
slot, always include the parsed value in the payload (so an emptied Airtable field clears the
column):
```ts
// UPDATE branch (and INSERT branch): write each MAPPED session slot, null included.
if (fieldMap.session_1) payload.session_1 = parseTime(fields[fieldMap.session_1]); // null clears a removed session
if (fieldMap.session_2) payload.session_2 = parseTime(fields[fieldMap.session_2]);
if (fieldMap.session_3) payload.session_3 = parseTime(fields[fieldMap.session_3]);
```
- Drop the insert-branch `session_1: session1 ?? "00:00"` fallback — `session_1` is now nullable, and
  the fabricated midnight session was masking real data.
- An unmapped slot (`fieldMap.session_X` falsy) is **not** written — leaves the column untouched.
- **Refinement vs the task's suggestion:** the existing-rows query does **not** need to fetch current
  sessions. The DB trigger (Component 3) detects changes by diffing `OLD`/`NEW` in-DB; writing the
  full mapped session state every poll + trigger-side `IS DISTINCT FROM` guards against no-op change
  rows. The `status` fetch on that query stays as-is.

**Frontend null-guards** (TypeScript will flag these once `types.ts` marks `session_1` nullable):
- [AvailabilityPage.tsx:256](../../../src/pages/AvailabilityPage.tsx) — `d.session_1.slice(0,5)` →
  `d.session_1 ? d.session_1.slice(0,5) : '—'`.
- [ShowsBookingsPage.tsx:328](../../../src/pages/ShowsBookingsPage.tsx) — `sd.session_1.slice(0,5)` →
  guarded the same way.
- Already guarded (no change): `ArtistBookingsView.tsx:178,246`, `ShowDateDetailSheet.tsx:248-251`.

### 2. `open-offer-tier` ≥1-session gate

In [open-offer-tier/index.ts](../../../supabase/functions/open-offer-tier/index.ts): add the session
columns to the show-date select (`id, show_id, city_id, date, status, session_1, session_2,
session_3`), and after the existing `status === 'cancelled'` check:
```ts
if (!showDate.session_1 && !showDate.session_2 && !showDate.session_3)
  return json({ offers_created: 0, message: 'Show date has no sessions yet — offers not opened' });
```
A **benign 200 skip** (mirrors the function's existing "no city" / "no casts" skips), **not** a 400 —
so `airtable-poll`'s `openOfferTierBatch` doesn't count it as a failure and emit a misleading
"N of M open-offer-tier calls failed" warning (the trap flagged in the #107 review for
cancelled-on-arrival dates). Coordinates with the sibling reopen-offer-tier UI task, which surfaces
the `message` to the producer.

### 3. `show_date_change_log` table + trigger

**Table** (same migration):
```sql
CREATE TABLE public.show_date_change_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id)    ON DELETE CASCADE,
  change_type  text NOT NULL,   -- 'cancelled' | 'session_added' | 'session_removed' | 'session_retimed'
  session_slot smallint,        -- 1 | 2 | 3 for session changes; NULL for 'cancelled'
  old_value    text,            -- 'HH:MM' or NULL
  new_value    text,            -- 'HH:MM' or NULL
  created_at   timestamptz NOT NULL DEFAULT now(),
  digested_at  timestamptz      -- stamped when the digest consumes the row
);
CREATE INDEX idx_show_date_change_log_undigested
  ON public.show_date_change_log (org_id, digested_at) WHERE digested_at IS NULL;
CREATE INDEX idx_show_date_change_log_show_date
  ON public.show_date_change_log (show_date_id);
```
**RLS:** enable; add an org-member `SELECT` policy (`is_org_member(auth.uid(), org_id)`) for a possible
future UI, plus the standard RESTRICTIVE `org_isolation` policy. **No** authenticated INSERT/UPDATE/
DELETE policy — the `SECURITY DEFINER` trigger and the service-role digest are the only writers.

**Trigger** — `AFTER UPDATE OF session_1, session_2, session_3, status` (UPDATE-only, so the `WHEN`
clause *may* reference `OLD`; this is **not** a combined INSERT/UPDATE trigger, so it avoids the
Postgres `42P17` that bit #107):
```sql
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
Function (`SECURITY DEFINER`, `search_path = public`):
- **Cancel transition** (`NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'`): insert
  one `('cancelled', NULL, NULL, NULL)` row and `RETURN NULL` — skip session diffs (the whole date is
  dead; per-session noise is irrelevant to a released artist).
- **Still cancelled** (`NEW.status='cancelled'`, not a transition): `RETURN NULL` — a cancelled date
  has no active bookings.
- **Otherwise** (open/fill-state row, or a revival to `open`): for each slot where
  `OLD.session_X IS DISTINCT FROM NEW.session_X`, insert one row with `change_type` =
  `session_added` (old NULL) / `session_removed` (new NULL) / `session_retimed` (both present),
  `session_slot`, `old_value`, `new_value`.

**Why no `app.cancelling_show_date` GUC here** (refinement on the task's hint): the cascade
(`cascade_cancel_bookings_on_date_cancel`) updates **bookings**, not `show_dates`, so this `show_dates`
trigger fires exactly **once** per Airtable write and never re-fires from the cascade. Fill-state
status writes from the bookings recompute trigger (`compute_show_date_status`) are filtered out by the
`WHEN` clause (neither side `'cancelled'`, no session change ⇒ no fire). The in-function status branch
suppresses session noise on a cancellation. **This will be validated against the live DB
(BEGIN…ROLLBACK) before the migration is trusted** — exactly how the #107 `WHEN`-clause bug was caught.

### 4. Digest folding (`send-confirmation-digest/index.ts`)

Per active org at its `confirmation_digest_hour_berlin`:
1. Query the org's undigested change rows joined to their show_date context:
   `show_date_change_log` where `org_id = org AND digested_at IS NULL`, joined to
   `show_dates(date, session_1..3, status, cancellation_reason, shows(program, sub_program), cities(name))`.
2. Keep the existing confirmed-bookings query. **Skip the org only if BOTH are empty** (today it
   `continue`s when confirmations are empty — that must no longer skip an org that has changes).
3. **Coalesce** change rows per `(show_date_id, slot)` into net diffs via a pure helper
   `coalesceChangeRows` in `supabase/functions/_shared/scheduleChanges.ts`: order by `created_at`, take
   the earliest `old_value` + latest `new_value` per slot, drop a slot whose net `old == new` (a
   reverted change self-cancels). `cancelled` changes pass through as a per-date flag. Output: one
   `DateChangeSummary` per show_date `{ show, date, city, cancelled, reason, sessions: [{slot, kind,
   old, new}] }`.
4. **Resolve recipients** per changed date, in a single bookings query over the affected date ids,
   partitioned by the date's `cancelled` flag:
   - cancelled date → bookings with `status='cancelled' AND cancellation_reason='date_cancelled'`
     (the just-released set);
   - session-changed date → bookings with `status IN ('suggested','soft_booked','confirmed')`.
   Join `artists(id, name, email, user_id)`.
5. **In-app notifications** — one `notifications` row per registered artist (`user_id` not null) per
   changed date: `type='schedule_change'`, `org_id`, `title`/`message` reflecting cancel vs retime,
   `related_entity_type='show_date'`, `related_entity_id=show_date_id` (the `tier-at-risk-watcher`
   pattern). Unregistered artists get no in-app row (email only).
6. **Email** — merge schedule-change recipients into the existing per-artist `grouped` map (an artist
   may have new confirmations **and** changes → one email). Collect `user_id`s across **both** sources
   for the one `resolve_user_contacts` call; address login-email-first per ADR-0011, falling back to
   the booking email (the only address an unregistered artist has). Reuse the existing per-artist
   `idempotency_key` so a same-hour cron retry produces one email.
7. **Stamp** `digested_at = now()` on all consumed change rows after the per-artist loop (best-effort
   email, matching the digest's existing "email sent → stamped, errors logged" semantics). The stamp +
   the email idempotency key together prevent duplicate sends/notifications on a cron retry.

Pure helpers extracted to `_shared/scheduleChanges.ts` (`classifySessionChange(old,new)`,
`coalesceChangeRows(rows)`, summary/label builders) are unit-tested directly; the orchestration is
covered by the `handle()` edge test.

### 5. Email template (adaptive) — `artist-confirmation-digest.tsx`

- Props gain optional `scheduleChanges?: Array<{ show; date; city; changes: string }>` and
  `cancellations?: Array<{ show; date; city; reason?: string }>` (alongside existing `bookings`).
- `subject` becomes a function: neutral `"Your booking updates — Showflow Pro"` when
  `scheduleChanges`/`cancellations` are present, else the existing
  `"Your bookings are confirmed — Showflow Pro"`. (The registry already resolves a function `subject`
  — `send-transactional-email/index.ts:141`. An org-level static subject override, if set, wins; that
  is acceptable.)
- Heading/intro adapt similarly; render a **Confirmed** table (existing), a **Schedule changes** table,
  and a **Cancelled** table, each only when non-empty. Extend `previewData`.

## Testing strategy (test-first)

| Layer | Covers |
|---|---|
| **pgTAP** | `log_show_date_schedule_change`: session add/remove/retime each emit the right `change_type`/`session_slot`/`old`/`new`; a cancel transition emits exactly one `'cancelled'` row and **no** session rows; a fill-state status change (`open`→`fully_filled`) and a no-op update emit **nothing**; a revival (`cancelled`→`open`) emits nothing. `session_1` accepts `NULL` (including an all-null-sessions row). |
| **Edge (Deno)** | `airtable-poll`: a mapped-but-emptied session clears the column to `null` (removal gap); insert no longer fabricates `00:00`. `open-offer-tier`: a zero-session date → benign skip (`offers_created: 0`, no offers inserted). `send-confirmation-digest`: undigested rows → coalesced per-date summaries; recipients resolved per change type (released vs active); in-app rows for registered artists only; adaptive email payload; `digested_at` stamped; an org with **only** changes (no confirmations) is still processed; an idempotent re-run does not reprocess stamped rows. `_shared/scheduleChanges.ts` helper units. |
| **Live-DB (Supabase MCP, BEGIN…ROLLBACK)** | The trigger fires correctly on the real schema; the cascade and the log trigger coexist without double-logging; fill-state booking writes stay silent — verified before the migration is relied upon. |

## Risks & edge cases

- **Trigger noise from fill-state status changes** — guarded by the `WHEN` clause *and* the in-function
  status check; pgTAP + live-DB verified.
- **Cancellation recipient timing** — the cascade has already set the bookings to `cancelled` by digest
  time, so cancellation recipients are resolved via `cancellation_reason='date_cancelled'`, not "active
  bookings". (A date cancelled → revived → re-cancelled within one digest window is unlikely; v1
  notifies on the latest cancelled state.)
- **`session_1` nullable ripple** — two unguarded `.slice()` call-sites fixed (Component 1); the rest
  already guard. `types.ts` must mark `session_1` nullable so `tsc` flags any new offender in CI.
- **Coalescing reverts** — a session added then removed before the digest nets to `null==null` ⇒ no row
  ⇒ no notification. Correct.
- **Idempotency** — `digested_at` + the per-artist email idempotency key prevent duplicate
  emails/notifications on a cron retry.
- **Unregistered artists** (no `user_id`) — email only; `resolveContactEmail` falls back to the booking
  email.
- **RLS** — the digest reads/writes the change log via the service-role admin client (RLS bypassed);
  the trigger is `SECURITY DEFINER`; org members get read-only `SELECT`.

## File touch-list

- `supabase/migrations/<ts>_schedule_change_notifications.sql` — `session_1` DROP NOT NULL;
  `show_date_change_log` table + RLS + indexes; `log_show_date_schedule_change` function + trigger.
- `supabase/functions/airtable-poll/index.ts` (+ `index.test.ts`) — write all mapped session slots
  (clear on empty); drop the insert `00:00` fallback.
- `supabase/functions/open-offer-tier/index.ts` (+ test) — ≥1-session benign-skip guard; session cols
  in the select.
- `supabase/functions/send-confirmation-digest/index.ts` (+ test) — fold the change log: query,
  coalesce, per-type recipients, in-app notifications, adaptive email payload, stamp.
- `supabase/functions/_shared/scheduleChanges.ts` (+ test) — pure `classifySessionChange` /
  `coalesceChangeRows` / summary helpers.
- `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx` — adaptive
  subject/heading + Schedule changes / Cancelled sections + `previewData`.
- `src/pages/AvailabilityPage.tsx`, `src/pages/ShowsBookingsPage.tsx` — `session_1` null-guards.
- `src/integrations/supabase/types.ts` — `session_1` nullable; new `show_date_change_log` table
  (regenerated via the Supabase MCP, or hand-edited to match the migration with CI `tsc` validating).
- `supabase/tests/<n>_schedule_change.sql` (pgTAP) — trigger + nullable-session coverage.

## Non-goals (YAGNI)

- Real-time (pre-digest) in-app delivery — notifications are created at digest time, per decision 4.
- Auto-reopening offers when a session is re-added to a previously zero-session date — separate
  (blocked on the reopen-offer-tier UI sibling task).
- A UI to browse `show_date_change_log` history.
- Notifying artists who only have cast *eligibility* (no booking) on a changed date.
- Coalescing across multiple digest windows — once `digested_at` is stamped, prior changes are not
  re-summarized.
- A DB `CHECK` for ≥1 session (decision 2).
