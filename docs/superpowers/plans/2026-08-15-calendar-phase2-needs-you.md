# Calendar Phase 2 — Needs-you queue + net-new backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the producer default **"Needs you"** action-queue lens (grouped cards + QueueRail) to the calendar surface, plus the small net-new backend it needs: an atomic `extend_offer_expiry` RPC, an immediate `notify-cast` edge action, and one focused per-date bookings-with-artist read.

**Architecture:** A pure derivation lib `src/lib/calendar/needsYou.ts` buckets `ProducerDateEntry[]` (+ per-date people rows + ready-to-issue set) into four ordered groups. Two presentational components (`NeedsYouLens`, `QueueRail`) render it. `CalendarSurface` gains a `needs-you` lens branch (the producer default). `ShowsBookingsPage` supplies the reads (existing `fetchShowDatesList`/`fetchBookingCountsByDate`/`useDatesReadyForHireOrder` + a net-new `fetchBookingsWithArtistForDates`, and `dryRunOfferTier` for the rail shortlist) and wires the card actions to existing mutations plus two net-new ones (`extendOfferExpiry`, `notifyCast`). Release-hold reuses `bulkDeclineSoftBooked`.

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn, `@tanstack/react-query` v5, Vitest + jsdom + Testing Library, date-fns. Supabase Postgres (migration + RPC), Deno edge function, pgTAP. Design tokens in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-integrated-surface-design.md` (§4.1 Needs you, §5.1 extra reads, §5.3 net-new backend, §11 open items) — read it alongside this plan.

**Builds on:** `docs/superpowers/plans/2026-08-15-calendar-integrated-surface.md` (Phase 1, merged PR #294). The Phase-1 kit (`src/lib/calendar/*`, `src/components/calendar/surface/*`) is assumed present.

## Global Constraints

- **Semantic tokens only** in components: `bg-success/10`, `text-warning`, `border-border`, `text-primary`. Never hardcode hex or `bg-white`/`text-black`. **Accent numbered stops (`accent-50`…`900`) do NOT take `/opacity` modifiers** — use a solid stop or `rgba()`.
- **Week starts Monday everywhere.** Manual grids/week grouping: leading pad `(getDay()+6)%7`; ISO week via `startOfWeek(d,{weekStartsOn:1})`.
- **Test-first (TDD).** Write the failing test, watch it fail, implement minimally, watch it pass, commit. Co-locate tests beside the file.
- **Tests import the real module.** Never re-implement production logic in a test.
- **Data-access pattern:** Supabase reads/writes are `fetchX(client, args)`/`mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers. Test with `src/test/supabaseFake.ts` — never `vi.mock` the client. Edge functions export `handle(req, deps)` and test via `makeFakeDeps` from `supabase/functions/_shared/testing.ts`.
- **No `any`** (CI `--max-warnings 0`). Explicit row interfaces + single `as unknown as` cast at the query boundary, confined to `src/data/**` / hook `queryFn`s / `supabase/functions/**`.
- **i18n:** user-facing strings via `t('…')` in the `bookings` namespace; EN canonical, DE key-for-key (`keyParity.test.ts`), informal "Du", **no em/en dashes** (`copyLint.test.ts`). New keys typed.
- **Query keys:** `['bookings', …]` for anything reading `bookings`; `['show-dates', …]` for `show_dates`; `['hire-orders', …]` for hire orders. Mutations invalidate the whole domain prefix (e.g. `queryClient.invalidateQueries({ queryKey: ['bookings'] })`).
- **Gating:** the whole surface + engine is behind the `booking_flow` entitlement (RLS + edge `requireFeature` + UI). Action buttons additionally gated by `useCan('confirm_bookings' | 'generate_hire_orders' | 'run_offer_engine')`.
- **Berlin clock for booking dates.** "Today"/"expires today"/past-date exclusion compare against Europe/Berlin wall-clock, matching `tier-at-risk-watcher` (`berlinDateKey`) and the cockpit. Use the existing helper (see Task 4) — do not roll a new TZ conversion.
- **Migrations:** never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`. Create migrations via the migration tool. After a new RPC/column: regenerate types (`supabase gen types typescript --local > src/integrations/supabase/types.ts`) then `npm run sync:mirrors`; verify `npm run sync:mirrors:check` + `npx tsc -p tsconfig.app.json --noEmit`.
- **Type-check three projects** before done: `npx tsc -p tsconfig.app.json --noEmit`; `npx tsc -p tsconfig.tools.json --noEmit`; `deno check --node-modules-dir=none supabase/functions/notify-cast/index.ts`. Lint: `npm run lint`. Unit: `npx vitest run`. DB: `supabase test db`.

### Cross-plan coordination (shared file)

This plan and the **Phase 3** plan both add one additive field to the SAME three locations:
- Phase 2 adds `castNotifiedAt: string | null` to `ProducerDateEntry` + `ProducerShowDateRow` + `toProducerEntries`.
- Phase 3 adds `showId: string`.

Both fields are **optional-additive** and independent. If the two plans run concurrently, expect a trivial merge in `src/lib/calendar/types.ts` (interface field list), `src/lib/calendar/producerData.ts` (select cols + mapping), and `src/data/showDates.ts` (`SHOW_DATE_LIST_COLS`). Sequence Phase 2's Task 5 before Phase 3's Task 1, or merge the field lists by hand — there is no logic conflict.

---

## Needs-you semantics (locked from research)

Grounded in the backend research (do not re-derive):

1. **`offer_expires_at`** (`bookings`, `TIMESTAMPTZ`, nullable) is **NOT** set at offer creation — `send-offer-digest` stamps it (`offered_at + response_window`). A fresh `suggested` offer has `offer_expires_at = NULL`. **"Expires today" treats `NULL` as "no deadline yet" and excludes it.**
2. **"At risk"** is pure fill math, **no time window**: an entry is at risk when `pendingMain + acceptedMain < mainSlots` (i.e. `mainSlots > confirmedMain + acceptedMain + pendingMain`… see exact formula in Task 4), for a **future-or-today** date (Berlin), non-cancelled, with `mainSlots > 0`. This mirrors `tier-at-risk-watcher` (`countPendingNotExpired + countAccepted < requiredPrimarySlots`). The card's "lead-time countdown" is display only (days-to-date), not a filter.
3. **"Ready to issue"** = `useDatesReadyForHireOrder().readyIds` (org-wide `fully_filled` dates with no active hire order).
4. **"Cancelled · needs a decision"** = `status === 'cancelled'` AND `castNotifiedAt == null`. The net-new `cast_notified_at` marker on `show_dates` moves a date out of this group once the producer notifies.
5. **Notify-cast** is **in-app only** (per spec §5.3.2 — inserts `notifications`, no email). Today the only cancellation notification is the delayed 20:00 `send-confirmation-digest`, and it doesn't cover producer-cancelled individual holds at all. The edge action (a) inserts immediate `notifications` for the date's cancelled-booking registered artists, (b) stamps `show_dates.cast_notified_at = now`, and (c) stamps the matching un-digested `show_date_change_log.digested_at` so the 20:00 digest does not re-insert a duplicate `schedule_change` notification for the same cancellation.
6. **Extend hold 24h** bumps `offer_expires_at` by 24h for the date's `suggested`/`soft_booked` rows via an atomic SQL RPC (`+ interval`), because PostgREST cannot express a column-relative update. A `NULL` expiry row is `COALESCE`d to `now()` first (gives it a fresh 24h deadline).
7. **Shortlist** (QueueRail, top at-risk date) = `dryRunOfferTier(client, { showDateId, tier: 1 })`'s `candidates` (eligible + free artists); no new backend. "Offer" on a shortlist row calls `openOfferTier`.

---

## File structure (Phase 2)

```
supabase/migrations/
  <ts>_extend_offer_expiry_rpc.sql             # RPC: extend_offer_expiry(p_show_date_id, p_hours)
  <ts>_show_dates_cast_notified_at.sql         # ALTER TABLE show_dates ADD cast_notified_at TIMESTAMPTZ
supabase/functions/notify-cast/
  index.ts                                     # handle(req, deps): insert notifications + stamp markers
  index.test.ts                                # Deno test via makeFakeDeps
supabase/config.toml                           # [functions.notify-cast] verify_jwt = true
supabase/tests/rls/
  bookings_and_audit.sql                       # +cases: extend_offer_expiry producer/other-org
  notify_cast_markers.sql                      # (new) cast_notified_at RLS + change-log stamp
src/data/bookings.ts                           # +extendOfferExpiry, +fetchBookingsWithArtistForDates, +notifyCast
  bookings.test.ts                             # (extend/people/notify cases via supabaseFake)
src/lib/calendar/
  needsYou.ts   needsYou.test.ts               # buildNeedsYouQueue + types
  types.ts                                     # +castNotifiedAt on ProducerDateEntry (optional)
  producerData.ts                              # +castNotifiedAt mapping
src/data/showDates.ts                          # SHOW_DATE_LIST_COLS +cast_notified_at
src/components/calendar/surface/
  NeedsYouLens.tsx   NeedsYouLens.test.tsx
  QueueRail.tsx      QueueRail.test.tsx
  CalendarSurface.tsx                          # +needs-you lens branch (producer default)
src/hooks/useBookingsWithArtist.ts             # thin wrapper for the queue read
src/pages/ShowsBookingsPage.tsx                # wire reads + actions + default lens
src/i18n/locales/{en,de}/bookings.json         # +needsYou.* keys
```

---

## WAVE A — net-new backend + pure lib (parallel: 4 concurrent)

### Task 1: `extend_offer_expiry` RPC + `extendOfferExpiry` data fn

**Files:**
- Create: `supabase/migrations/<ts>_extend_offer_expiry_rpc.sql`
- Modify: `src/data/bookings.ts` (add `extendOfferExpiry`)
- Test: `src/data/bookings.test.ts` (add case); `supabase/tests/rls/bookings_and_audit.sql` (add cases)

**Interfaces — Produces:**
```ts
export async function extendOfferExpiry(
  client: SupabaseClient<Database>,
  args: { showDateId: string; hours: number },
): Promise<{ affected: number }>;
```

- [ ] **Step 1: Write the RPC migration.** Create it via the migration tool with this body (SECURITY INVOKER so RLS + the `booking_flow` write gate + producer policy apply unchanged):
```sql
create or replace function public.extend_offer_expiry(
  p_show_date_id uuid,
  p_hours int
) returns integer
language sql
security invoker
set search_path = public
as $$
  with updated as (
    update public.bookings
       set offer_expires_at = coalesce(offer_expires_at, now()) + make_interval(hours => p_hours)
     where show_date_id = p_show_date_id
       and status in ('suggested','soft_booked')
    returning id
  )
  select count(*)::int from updated;
$$;

revoke all on function public.extend_offer_expiry(uuid, int) from public;
grant execute on function public.extend_offer_expiry(uuid, int) to authenticated;
```
> Rationale: `make_interval(hours => p_hours)` is the column-relative bump PostgREST can't do. `security invoker` keeps the producer/admin + `booking_flow` RESTRICTIVE gate enforcing auth (a non-member's UPDATE affects 0 rows). Status stays in `suggested`/`soft_booked`, so the `enforce_booking_transition` trigger (fires only `OF status`) is not involved.

- [ ] **Step 2: Regenerate types + mirrors.** Apply locally (`supabase db reset` or the migration tool against the local stack), then `supabase gen types typescript --local > src/integrations/supabase/types.ts` and `npm run sync:mirrors`. Verify `npm run sync:mirrors:check`.

- [ ] **Step 3: Write the failing data-access test** in `src/data/bookings.test.ts`:
```ts
import { extendOfferExpiry } from './bookings';
import { makeSupabaseFake } from '@/test/supabaseFake';

it('extendOfferExpiry calls extend_offer_expiry RPC and returns affected count', async () => {
  const fake = makeSupabaseFake({ rpc: { extend_offer_expiry: 2 } });
  const res = await extendOfferExpiry(fake.client, { showDateId: 'sd-1', hours: 24 });
  expect(res.affected).toBe(2);
  expect(fake.rpcCalls).toContainEqual({ fn: 'extend_offer_expiry', args: { p_show_date_id: 'sd-1', p_hours: 24 } });
});
```
> Check `src/test/supabaseFake.ts` for the exact `rpc` stub + call-recording API (`rpcCalls`/`recordedRpc`); match its real shape rather than the illustrative names above.

- [ ] **Step 4: Run → FAIL** — `npx vitest run src/data/bookings.test.ts`.

- [ ] **Step 5: Implement `extendOfferExpiry`** in `src/data/bookings.ts` (mirror the existing `bulkConfirmSoftBooked` shape — client first, throw on error):
```ts
export async function extendOfferExpiry(
  client: SupabaseClient<Database>,
  args: { showDateId: string; hours: number },
): Promise<{ affected: number }> {
  const { data, error } = await client.rpc('extend_offer_expiry', {
    p_show_date_id: args.showDateId,
    p_hours: args.hours,
  });
  if (error) throw error;
  return { affected: (data as number | null) ?? 0 };
}
```

- [ ] **Step 6: Run → PASS.** `npx vitest run src/data/bookings.test.ts`.

- [ ] **Step 7: Add pgTAP cases** to `supabase/tests/rls/bookings_and_audit.sql` (bump the `plan(N)`): as a producer of the org, `select public.extend_offer_expiry('<suggested-date>', 24)` returns `> 0` and the row's `offer_expires_at` advanced ~24h; as a member of another org it returns `0` (no rows visible/updatable). Run `supabase test db`.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(bookings): extend_offer_expiry RPC + data fn"`

### Task 2: `notify-cast` edge action + `cast_notified_at` marker

**Files:**
- Create: `supabase/migrations/<ts>_show_dates_cast_notified_at.sql`
- Create: `supabase/functions/notify-cast/index.ts`, `supabase/functions/notify-cast/index.test.ts`
- Modify: `supabase/config.toml` (`[functions.notify-cast] verify_jwt = true`)
- Modify: `src/data/bookings.ts` (add `notifyCast`)
- Test: `src/data/bookings.test.ts`; `supabase/tests/rls/notify_cast_markers.sql`

**Interfaces — Produces:**
```ts
export async function notifyCast(
  client: SupabaseClient<Database>,
  args: { showDateId: string },
): Promise<{ notified: number }>;   // invokes the notify-cast edge function
```

- [ ] **Step 1: Migration — add the marker column.** Via the migration tool:
```sql
alter table public.show_dates add column if not exists cast_notified_at timestamptz;
comment on column public.show_dates.cast_notified_at is
  'When a producer explicitly notified cast that this date was cancelled (Needs-you queue).';
```
Regenerate types + `npm run sync:mirrors` (Task 1 Step 2 flow).

- [ ] **Step 2: Register the function.** Add to `supabase/config.toml`:
```toml
[functions.notify-cast]
verify_jwt = true
```

- [ ] **Step 3: Write the failing edge test** `supabase/functions/notify-cast/index.test.ts` using `makeFakeDeps` from `_shared/testing.ts`. Assert: given a cancelled `show_date` with two cancelled bookings whose artists have `user_id` set, `handle(req, deps)` (a) inserts 2 `notifications` rows (`type:'schedule_change'`, `title:'Booking cancelled'`, `related_entity_type:'show_date'`, carrying `org_id`), (b) updates `show_dates.cast_notified_at`, (c) stamps the un-digested `show_date_change_log` row's `digested_at`, and returns `{ notified: 2 }`. Add a second case: caller lacking producer/admin role → 403. Follow existing `_shared/auth.ts` + `_shared/http.ts` patterns; model it on `tier-at-risk-watcher`/`send-confirmation-digest` insert code.

- [ ] **Step 4: Run → FAIL** — `deno test --allow-all supabase/functions/notify-cast/`.

- [ ] **Step 5: Implement `handle`.** Export `handle(req, deps)` + `Deno.serve((req)=>handle(req, realDeps()))`. Flow: CORS/`json` via `_shared/http.ts`; parse `{ show_date_id }`; resolve the date's `org_id`; `await requireOrgRole(deps, org_id, ['admin','producer'])`; `await requireFeature(org, 'booking_flow')`; select the date's bookings with `cancellation_reason='date_cancelled'` (or `status='cancelled'`) joined to `artists(user_id)`; build one `notifications` row per artist with `user_id != null`; batch-insert via the service-role client; `update show_dates set cast_notified_at = deps.now()`; `update show_date_change_log set digested_at = deps.now() where show_date_id = ? and change_type='cancelled' and digested_at is null`; return `{ notified }`. Use the columns exactly as Section D of research (`org_id,user_id,type,title,message,related_entity_type,related_entity_id`).

- [ ] **Step 6: Run → PASS** — `deno test --allow-all supabase/functions/notify-cast/`; `deno check --node-modules-dir=none supabase/functions/notify-cast/index.ts`.

- [ ] **Step 7: Add `notifyCast` data fn** (invokes the function) to `src/data/bookings.ts`, with a failing-then-passing `src/data/bookings.test.ts` case (fake `functions.invoke` returns `{ notified: 2 }`):
```ts
export async function notifyCast(
  client: SupabaseClient<Database>,
  args: { showDateId: string },
): Promise<{ notified: number }> {
  const { data, error } = await client.functions.invoke('notify-cast', {
    body: { show_date_id: args.showDateId },
  });
  if (error) throw error;
  return { notified: (data as { notified?: number } | null)?.notified ?? 0 };
}
```

- [ ] **Step 8: Add pgTAP** `supabase/tests/rls/notify_cast_markers.sql`: a producer can `update show_dates set cast_notified_at=now()` for their org's date; a foreign-org member cannot. (`plan(2)`.) Run `supabase test db`.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(bookings): notify-cast edge action + cast_notified_at marker"`

### Task 3: `fetchBookingsWithArtistForDates` (people chips read)

**Files:**
- Modify: `src/data/bookings.ts`
- Test: `src/data/bookings.test.ts`

**Interfaces — Produces:**
```ts
export interface BookingWithArtistRow {
  id: string; showDateId: string;
  status: 'suggested' | 'soft_booked' | 'confirmed' | 'cancelled';
  isUnderstudy: boolean;
  offerExpiresAt: string | null;
  artist: { id: string; name: string } | null;
}
export async function fetchBookingsWithArtistForDates(
  client: SupabaseClient<Database>,
  args: { orgId: string; showDateIds: string[] },
): Promise<BookingWithArtistRow[]>;
```
> Serves both the queue's people chips AND the "Expires today" earliest-expiry (that's why `offerExpiresAt` is selected here rather than a second query).

- [ ] **Step 1: Write the failing test** — fake returns 2 rows for 1 date (one `soft_booked` with artist, one `cancelled`); assert the mapped shape (camelCase, `isUnderstudy` from `is_understudy`, `artist` flattened). Empty `showDateIds` → returns `[]` without querying.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — mirror `fetchSoftBookedRows` (which already joins `artist:artists(id,name)`), but `.in('show_date_id', args.showDateIds).eq('org_id', args.orgId)` with no status filter (the derivation buckets by status). Early-return `[]` when `showDateIds.length === 0`. Single `as unknown as Row[]` cast after the error check.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): fetchBookingsWithArtistForDates for needs-you people chips"`

### Task 4: `needsYou.ts` pure derivation

**Files:**
- Create: `src/lib/calendar/needsYou.ts`, `src/lib/calendar/needsYou.test.ts`
- Modify: `src/lib/calendar/types.ts` (add `castNotifiedAt?: string | null` to `ProducerDateEntry`)
- Modify: `src/lib/calendar/producerData.ts` + `src/data/showDates.ts` (select + map the column)

**Interfaces — Consumes:** `ProducerDateEntry` (types.ts); `BookingWithArtistRow` (bookings.ts); `berlinDateKey`/date helpers. **Produces:**
```ts
export type NeedsYouGroupKey = 'expires-today' | 'at-risk' | 'ready-to-issue' | 'cancelled';
export interface NeedsYouPerson { artistId: string; name: string; status: BookingWithArtistRow['status']; isUnderstudy: boolean }
export interface NeedsYouItem {
  dateId: string; entry: ProducerDateEntry; group: NeedsYouGroupKey;
  people: NeedsYouPerson[];
  earliestExpiry: Date | null;   // 'expires-today'
  openMainSlots: number;         // 'at-risk' = mainSlots - (confirmedMain+acceptedMain+pendingMain), floored at 0
  leadDays: number;              // days from today to the date (display; can be 0)
}
export interface NeedsYouGroup { key: NeedsYouGroupKey; items: NeedsYouItem[] }
export interface NeedsYouQueue {
  groups: NeedsYouGroup[];                    // non-empty groups only, canonical order
  totalItems: number;
  countByGroup: Record<NeedsYouGroupKey, number>;
}
export function buildNeedsYouQueue(args: {
  entries: ProducerDateEntry[];
  people: BookingWithArtistRow[];
  readyIds: Set<string>;
  now: Date;
}): NeedsYouQueue;
```

Group assignment rules (each date lands in **at most one** group; evaluate in this priority so a date never appears twice):
1. **cancelled** — `entry.status === 'cancelled' && entry.castNotifiedAt == null`.
2. **expires-today** — non-cancelled; has ≥1 `suggested`/`soft_booked` person with a non-null `offerExpiresAt` whose Berlin date-key equals today's; `earliestExpiry` = min such expiry.
3. **ready-to-issue** — `readyIds.has(entry.id)`.
4. **at-risk** — non-cancelled, future-or-today (Berlin), `entry.mainSlots > 0`, and `entry.confirmedMain + entry.acceptedMain + entry.pendingMain < entry.mainSlots`; `openMainSlots = mainSlots - (confirmed+accepted+pending)`.

Canonical group order for display: `expires-today`, `at-risk`, `ready-to-issue`, `cancelled` (matches spec §4.1). Priority order above (cancelled first) is only for de-duping membership; the returned `groups` array uses the display order.

- [ ] **Step 1: Add `castNotifiedAt`** — in `types.ts` add `castNotifiedAt?: string | null` to `ProducerDateEntry`; in `src/data/showDates.ts` add `cast_notified_at` to `SHOW_DATE_LIST_COLS` and `ProducerShowDateRow` (in `producerData.ts`); in `toProducerEntries` map `castNotifiedAt: sd.cast_notified_at ?? null`. `npx tsc -p tsconfig.app.json --noEmit` → PASS (optional field, no existing consumer breaks).
- [ ] **Step 2: Write the failing test** `needsYou.test.ts` — build 4 fixture entries (one cancelled+unnotified, one with a soft_booked person expiring today, one in `readyIds`, one under-cast future). Assert `groups` has 4 non-empty groups in display order, `countByGroup` is `{...:1}` each, and the at-risk item's `openMainSlots` is correct. Add a de-dup case: a cancelled+unnotified date that is ALSO in `readyIds` appears only under `cancelled`. Deterministic `now = new Date(2026, 7, 15, 12, 0)`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `buildNeedsYouQueue`.** Group `people` by `showDateId` into a `Map`. For the Berlin date-key comparison and future-or-today check, reuse the existing helper — check `src/lib/bookingCockpit.ts` / `src/lib/dates.ts` for a `berlinDateKey`/`toDateKey` you can import; if only the Deno twin exists (`_shared`), add a tiny `berlinDateKey(date)` to `src/lib/dates.ts` with its own unit test rather than duplicating logic inline. Compute each group per the rules; drop empty groups; return in display order.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** — `git commit -am "feat(calendar): needsYou queue derivation + cast_notified_at plumbing"`

---

## WAVE B — presentational components (parallel: 2 concurrent, depend on A)

### Task 5: QueueRail

**Files:**
- Create: `src/components/calendar/surface/QueueRail.tsx`, `QueueRail.test.tsx`

**Interfaces — Consumes:** `NeedsYouQueue`, `NeedsYouGroupKey`, `FillMeter`. **Produces:**
```ts
export interface QueueShortlistArtist { artistId: string; name: string }
interface QueueRailProps {
  queue: NeedsYouQueue;
  clearedToday: number;                    // receipts count (from page state)
  shortlist: { dateId: string; dateLabel: string; artists: QueueShortlistArtist[] } | null;
  onOffer?: (dateId: string, artistId: string) => void;
  className?: string;
}
```
Renders (per spec §3.4 QueueRail): a **"Clear the queue"** card (progress = `clearedToday / (clearedToday + queue.totalItems)`, plus a per-group breakdown from `queue.countByGroup`), an **eligible-artist shortlist** card for the top at-risk date (each artist row + an "Offer" button firing `onOffer`), and a static **"What lands here"** rules card. All copy via `t('bookings:needsYou.rail.*')`.

- [ ] **Step 1: Write the failing test** — a queue with counts `{expires-today:1, at-risk:2}` + a shortlist of 2 artists → progress card shows the breakdown; clicking "Offer" on the first shortlist artist fires `onOffer(dateId, artistId)`. Use `data-testid`s (`queue-rail-progress`, `queue-offer-<artistId>`) matching the kit idiom.
- [ ] **Step 2–4:** FAIL → implement (shadcn `Card`; `FillMeter` or a simple token progress bar for the meter; tokens only) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): QueueRail"`

### Task 6: NeedsYouLens

**Files:**
- Create: `src/components/calendar/surface/NeedsYouLens.tsx`, `NeedsYouLens.test.tsx`

**Interfaces — Consumes:** `NeedsYouQueue`, `NeedsYouItem`, `FillMeter`, `PRODUCER_TONES`, `ActionGates`. **Produces:**
```ts
export type NeedsYouAction =
  | 'confirm'        // Confirm N holds (expires-today) / Confirm holds
  | 'extend'         // Extend 24h
  | 'release'        // Release (bulkDeclineSoftBooked)
  | 'open-casting'   // Open casting (at-risk)
  | 'cancel-date'    // Cancel date (at-risk secondary)
  | 'generate'       // Generate hire order (ready-to-issue)
  | 'preview'        // Preview (ready-to-issue secondary)
  | 'notify'         // Notify cast (cancelled)
  | 'undo-cancel';   // Undo cancel (cancelled secondary)
interface NeedsYouLensProps {
  queue: NeedsYouQueue;
  onItemAction: (item: NeedsYouItem, action: NeedsYouAction) => void;
  onOpenDate: (dateId: string) => void;
  onBulk: (group: NeedsYouGroupKey, action: 'confirm' | 'generate') => void;   // Confirm all / Generate N
  receipts: { dateId: string; title: string; label: string }[];
  onUndoLast?: () => void;
  actionGates?: ActionGates;
  className?: string;
}
```
Renders each non-empty group as a titled section with a group-level bulk button where applicable (`expires-today` → "Confirm all", `ready-to-issue` → "Generate N hire orders") and one card per item. Card content per group (spec §4.1): people chips (from `item.people`), a note, primary + two secondary actions mapped to `NeedsYouAction`, and a fill meter for slot state. Footer: **"Cleared today"** receipts with **"Undo last"**. Row/card click → `onOpenDate(item.dateId)`. All copy via `t('bookings:needsYou.*')`; action labels use the count (e.g. `t('needsYou.confirmNHolds', { count })`).

- [ ] **Step 1: Write the failing test** — a queue with an `expires-today` item (2 held people) and a `ready-to-issue` item → both group sections render; "Confirm all" fires `onBulk('expires-today','confirm')`; the ready item's primary fires `onItemAction(item,'generate')`; a receipt row + "Undo last" (fires `onUndoLast`) render. Match kit `data-testid` idiom (`needs-you-group-<key>`, `needs-you-item-<dateId>`, `needs-you-bulk-<key>`).
- [ ] **Step 2–4:** FAIL → implement (Card per item; `FillMeter`; people rendered as small badges; tone via `PRODUCER_TONES`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): NeedsYouLens"`

---

## WAVE C — integration (sequential, depend on B)

### Task 7: CalendarSurface — add `needs-you` lens (producer default)

**Files:**
- Modify: `src/components/calendar/surface/CalendarSurface.tsx`
- Test: `src/components/calendar/surface/CalendarSurface.test.tsx`

**Interfaces — Consumes:** `NeedsYouLens`, `QueueRail`, `NeedsYouQueue`. **Produces:** widen `CalendarSurfaceActions` and props:
```ts
// added to CalendarSurfaceActions:
extendHold?: (dateId: string) => void;
releaseHold?: (dateId: string) => void;
notifyCast?: (dateId: string) => void;
cancelDate?: (dateId: string) => void;
undoCancel?: (dateId: string) => void;
previewHireOrder?: (dateId: string) => void;
offerArtist?: (dateId: string, artistId: string) => void;
confirmAll?: (dateIds: string[]) => void;
generateAll?: (dateIds: string[]) => void;
// added to CalendarSurfaceProps:
needsYouQueue?: NeedsYouQueue;
queueShortlist?: { dateId: string; dateLabel: string; artists: { artistId: string; name: string }[] } | null;
clearedToday?: { dateId: string; title: string; label: string }[];
onUndoLastReceipt?: () => void;
```

- [ ] **Step 1: Write the failing test** — mount `role="producer"`, `lens="needs-you"`, a `needsYouQueue` with one `at-risk` item → LensTabs shows Needs you first (default/active), `NeedsYouLens` renders the item, and `QueueRail` renders alongside (Needs-you shows the rail; no `PeriodNavigator`). Switching to `month` still works.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — prepend `{ key: 'needs-you', label: 'Needs you', count: needsYouQueue?.totalItems }` to `PRODUCER_LENSES` and make it the producer default (`defaultLensKey` when role producer). Add an `activeLens === 'needs-you'` branch that renders `<NeedsYouLens>` + `<QueueRail>` in the same two-column shell as Month (rail on the right), with NO `CalendarToolbar`/`PeriodNavigator` (the queue is period-agnostic). Map `NeedsYouAction` → the new `actions.*` callbacks (confirm→`confirmHolds`, extend→`extendHold`, release→`releaseHold`, open-casting→`openCasting`, cancel-date→`cancelDate`, generate→`generateHireOrder`, preview→`previewHireOrder`, notify→`notifyCast`, undo-cancel→`undoCancel`); `onBulk` → `confirmAll`/`generateAll` with the group's date ids; `onOpenDate`→`openDate`; QueueRail `onOffer`→`offerArtist`.
- [ ] **Step 4: Run → PASS** + `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): needs-you lens in CalendarSurface (producer default)"`

### Task 8: Wire ShowsBookingsPage — reads, actions, default lens

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`
- Create: `src/hooks/useBookingsWithArtist.ts`
- Test: `src/pages/ShowsBookingsPage.needsYou.test.tsx`

**Interfaces — Consumes:** `buildNeedsYouQueue`, `fetchBookingsWithArtistForDates`, `extendOfferExpiry`, `notifyCast`, `bulkDeclineSoftBooked`, `dryRunOfferTier`, `openOfferTier`, `useDatesReadyForHireOrder`, existing `confirmHoldsForDate`/`draftHireOrderForDate`/`openShowDate`/`openCastingDate`.

- [ ] **Step 1: Write the failing test** — render `ProducerShowsBookings` with a fake client returning: 3 show dates (one cancelled+unnotified, one under-cast future, one fully_filled ready), matching counts, and bookings-with-artist rows. Assert the Needs-you lens is the default and renders 3 group sections; clicking the cancelled item's "Notify cast" invokes `notify-cast`; clicking the ready item's "Generate hire order" triggers the draft action.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - Add `useBookingsWithArtist(orgId, dateIds)` hook (`queryKey: ['bookings','with-artist', orgId, dateIds]`, `enabled: !!orgId && dateIds.length>0`, `queryFn: () => fetchBookingsWithArtistForDates(supabase, { orgId, showDateIds: dateIds })`). Feed it the **queue-relevant date ids** — compute a first-pass queue from `producerEntries` + `readyIds` to know which dates need people rows, or simply pass all visible date ids (bounded by the page's current filter window). Keep it simple: pass the ids of non-cancelled + cancelled-unnotified + ready entries.
  - Build `needsYouQueue = buildNeedsYouQueue({ entries: producerEntries, people, readyIds: new Set(hireOrderReady?.readyIds ?? []), now: new Date() })` (memoized).
  - Compute `queueShortlist`: take the first `at-risk` item; `useQuery(['bookings','shortlist', dateId], () => dryRunOfferTier(supabase, { showDateId: dateId, tier: 1 }))` (enabled when an at-risk item exists); map `candidates` → `{artistId,name}`; `dateLabel` via `formatDateWithWeekday`.
  - Wire the new actions:
    - `extendHold: (id) => void extendOfferExpiry(supabase, { showDateId: id, hours: 24 }).then(({affected}) => { toast.success(t('needsYou.toast.extended', {count: affected})); queryClient.invalidateQueries({queryKey:['bookings']}); })` (gate on `canConfirmBookings && bookingOn`).
    - `releaseHold: (id) => confirm+bulkDeclineSoftBooked` (reuse `fetchSoftBookedIdsForDate` then `bulkDeclineSoftBooked`, mirror `confirmHoldsForDate`; invalidate `['bookings']`).
    - `notifyCast: (id) => void notifyCast(supabase,{showDateId:id}).then(({notified})=>{ toast.success(t('needsYou.toast.notified',{count:notified})); queryClient.invalidateQueries({queryKey:['show-dates']}); })`.
    - `cancelDate`/`undoCancel`: reuse the existing show-date status mutation the page already has for cancellation (find the current cancel path in `ShowDateDetailSheet`/`showDates` data — `updateShowDateStatus` or equivalent); if the page has no direct cancel action, route `cancelDate`→`openDate` (open the sheet where cancel lives) and note it. Prefer wiring the real mutation if present.
    - `previewHireOrder: (id) => hireOrderAction.mutate({ action:'preview', org_id, show_date_id:id })`.
    - `offerArtist: (dateId, artistId) => void openOfferTier(supabase,{ showDateId: dateId, tier: 1 }).then(...)` (gate on `useCan('run_offer_engine')`; note openOfferTier offers the whole eligible set for the tier — see "Open risk" below).
    - `confirmAll: (ids) => Promise.all(ids.map(confirmHoldsForDate))`; `generateAll: (ids) => ids.forEach(draftHireOrderForDate)`.
  - Add `clearedToday` receipts state: a local `useState<{dateId,title,label}[]>` appended to whenever a queue action succeeds (date + action label); `onUndoLastReceipt` pops the last (best-effort visual; the underlying mutation is not auto-reverted — label it "Undo last" only for the actions that are safely reversible, i.e. skip Undo for irreversible ones, or wire it to the real inverse where one exists). Keep receipts session-local.
  - Default lens: change the producer `lens` state initial value to `'needs-you'` and widen the `?lens=` allowlist union to include `'needs-you'`, `'week'`, `'season'` placeholders are NOT added here (Phase 3) — add only `'needs-you'`.
- [ ] **Step 4: Run tests + typecheck + lint** — `npx vitest run src/pages/ShowsBookingsPage*`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): wire needs-you queue reads + actions; default lens"`

### Task 9: i18n + PageMini/help review

**Files:**
- Modify: `src/i18n/locales/en/bookings.json`, `src/i18n/locales/de/bookings.json`
- Modify (if copy changed): `src/lib/minis/pages/bookings.ts`; assess `src/lib/help/items.ts`
- Test: `src/i18n/keyParity.test.ts` (runs in suite), `src/i18n/copyLint.test.ts`

- [ ] **Step 1:** Add all `needsYou.*` keys (group titles, card notes, action labels with `{count}`, rail copy, receipts, toasts) to EN, then mirror **key-for-key** in DE (informal "Du", **no dashes**). Replace every literal string introduced in Tasks 5–8 with `t('bookings:needsYou.…')`.
- [ ] **Step 2: Run** — `npx vitest run src/i18n/` → `keyParity` + `copyLint` PASS.
- [ ] **Step 3:** Review `PageMini page="bookings"`: the module explanation now leads with an action queue. Update its steps if the framing changed, or note "no change" in the PR. Assess help-center impact (`src/lib/help/items.ts`, EN+DE) for the new producer queue flow; update or state "No help center impact." in the PR.
- [ ] **Step 4: Commit** — `git commit -am "feat(bookings): needs-you i18n + minis/help review"`

---

## Phase 2 exit criteria
- Producer `/bookings` defaults to the **Needs you** lens; four groups (Expires today · At risk · Ready to issue · Cancelled) render from real data, empties hidden.
- Per-card actions wired: Confirm holds / Confirm all, Extend 24h (RPC), Release, Open casting, Generate hire order / Generate N, Preview, Notify cast (edge), plus the QueueRail shortlist "Offer".
- Net-new backend shipped with tests at every layer: `extend_offer_expiry` RPC (+ unit + pgTAP), `notify-cast` edge fn + `cast_notified_at` (+ Deno + pgTAP), `fetchBookingsWithArtistForDates` (+ unit), `buildNeedsYouQueue` (+ unit).
- All three tsc projects + lint + `vitest run` + `supabase test db` + `deno test` green. `booking_flow`/capability gates intact. i18n key-parity green.

## Open risks / verify during build
- **`offerArtist` fan-out:** `openOfferTier` offers the entire eligible set for the tier, not the single shortlisted artist. If per-artist offering is required, that's a backend change (an offer-single-artist path) out of this plan's scope — for now the shortlist "Offer" opens casting for the date's tier. Confirm the desired behavior at review; if single-artist is required, spin a follow-up.
- **Notify-cast / digest dedupe:** verify in an integration pass that stamping `show_date_change_log.digested_at` actually suppresses the 20:00 `send-confirmation-digest` re-insert (the digest must filter on `digested_at IS NULL`). If the digest keys off a different column, adjust the stamp target in Task 2 Step 5.
- **Receipts / Undo:** "Cleared today" is session-local UI. Only offer "Undo last" where a true inverse mutation exists (e.g. re-open a hold); do not present Undo for irreversible actions. Keep this honest rather than faking reversibility.
- **Shared-file merge with Phase 3:** see "Cross-plan coordination" above.

## Self-review notes
- Spec coverage: §4.1 (all four groups + footer receipts + QueueRail) → Tasks 4/5/6/7/8. §5.1 extra reads (bookings-with-artist, shortlist) → Tasks 3/8. §5.3.1 Extend 24h → Task 1. §5.3.2 Notify cast → Task 2. §5.4 gating → Tasks 7/8 (`useCan`, `booking_flow`). §11 risk-window "reuse tier-at-risk" → Task 4 (pure fill math, no new constant). §8 i18n/minis/help → Task 9.
- Type consistency: `NeedsYouQueue`/`NeedsYouItem`/`NeedsYouGroupKey`/`NeedsYouAction` defined in Tasks 4/6, consumed by 5/6/7/8 under the same names; `BookingWithArtistRow` defined in Task 3, consumed by 4/8; `extendOfferExpiry`/`notifyCast`/`fetchBookingsWithArtistForDates` signatures fixed in Tasks 1/2/3 and called verbatim in Task 8.
- Placeholder scan: the one deferred detail ("find the current cancel path") is an explicit lookup instruction with a concrete fallback (route to `openDate`), not a TODO.
