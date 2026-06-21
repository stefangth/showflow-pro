# Open / close offer tier — producer/admin actions in ShowDateDetailSheet — design

**Status:** Approved (brainstorming complete)
**Date:** 2026-06-21
**Author:** Stefan Schaal (with Claude)
**Related:** PR #107 (Airtable-driven date cancellation) reviewer follow-up #5 ("revival dead-end" —
a revived date returns to `status='open'` with no bookings and no way to re-open offers);
`docs/superpowers/specs/2026-06-20-schedule-change-notifications-design.md` (the sibling
*schedule-change notifications* task — owns the `open-offer-tier` ≥1-session gate this UI surfaces);
original product audit Part 1 ("open-offer-tier is the booking engine's ignition with no button").

## Context & goal

`open-offer-tier` ([supabase/functions/open-offer-tier/index.ts](../../../supabase/functions/open-offer-tier/index.ts))
is the booking engine's ignition: it creates `suggested` bookings for a `(show_date, tier)` and upserts
a `show_date_offer_tiers` row. It is **already authorized for `admin`/`producer`** callers and
**already enforces the ≥1-session gate** (a zero-session date returns a benign
`{ offers_created: 0, message: 'Show date has no sessions yet — offers not opened' }`). But **nothing
in the frontend invokes it** — today it only auto-fires from `airtable-poll` for newly-imported dates,
tier 1 only. There is also **no way to close a tier** from anywhere.

The tier lifecycle, verified in code:
- `show_date_offer_tiers.closed_at IS NULL` means a tier is **active in the pipeline**.
- `expire-offers` (hourly) escalates **open** tiers (`closed_at IS NULL`, `escalation_notified_at IS
  NULL`) that have expired unfilled → producer notification + email.
- `tier-at-risk-watcher` fires/clears `tier_at_risk` notifications for **open** tiers only.
- So **closing** a tier (`closed_at = now()`) stops escalation + at-risk alerts. Nothing currently
  sets `closed_at`.

Consequences today: a revived date can't restart offers (reviewer #5); non-Airtable orgs can't start
the flow from the UI; and once a tier is opened it can never be closed, so escalation/at-risk noise
runs until the offers expire on their own.

**Goal:** in [ShowDateDetailSheet.tsx](../../../src/components/shows/ShowDateDetailSheet.tsx) give
producers/admins a guided **Offers card** that can:
1. **Open** a chosen tier (behind a confirmation), surfacing the result via a `sonner` toast and
   invalidating `['bookings']`;
2. **Display already-opened tiers** with their state (opened / closed + date);
3. **Close** an open tier, letting the producer choose **at close-time** — in plain language — whether
   to withdraw the tier's unanswered offers or leave them live.

## Decisions (locked in brainstorming)

1. **Guided Offers card**, `canManage`-only, above "Assigned Artists". Data-driven tier dropdown lists
   only tiers that have casts for this date's city (`cast_city_priority.priority`), plus an **Ad-hoc
   casts (tier 99)** option when per-date casts exist (`show_date_cast_eligibility`). (Chosen over a
   fixed `1/2/3` dropdown or a free number input.)
2. **Confirmation before opening** (shadcn `AlertDialog`); the copy explains that re-opening an
   already-opened tier is **additive** (the function pre-filters artists who already have an
   offer/booking — re-open is idempotent/non-destructive).
3. **Display already-opened tiers** from `show_date_offer_tiers` (read-only); each **open** tier gets a
   **Close** action.
4. **Close is an edge function** `close-offer-tier` (mirrors `open-offer-tier`: server-enforced
   admin/producer auth; service-role bypass for cron/tests). Rationale over a direct client mutation:
   it centralizes "withdraw offers + mark closed" server-side and is **locally Deno-testable** (the dev
   machine is Deno-only).
5. **The producer chooses the close behavior at interaction time**, explained without jargon. The close
   dialog offers two choices:
   - **Withdraw unanswered offers** → cancel the tier's still-`suggested` bookings
     (`status='cancelled', cancelled_at=now(), cancellation_reason='tier_closed'` — mirrors the existing
     `expire_soft_bookings` cancel path). Soft-booked/confirmed artists keep their slot.
   - **Keep offers open** → only set `closed_at`; pending offers stay live until they expire.
   Implemented as a `withdraw: boolean` flag on `close-offer-tier`.
6. **Open re-activates a closed tier.** Closing makes open/close symmetric, which exposes a latent trap:
   `open-offer-tier` currently upserts the tier row with `ignoreDuplicates: true`, so re-opening a
   *closed* tier would leave `closed_at` set (the tier stays invisible to escalation/at-risk forever).
   Fix: the upsert becomes a **merge** that re-activates — `closed_at = null`, `opened_at = now()`,
   `escalation_notified_at = null`. This is the only behavioral change to `open-offer-tier`.
7. **Tier model** (verified): tiers 1..N from `cast_city_priority.priority` (per cast, per city);
   **tier 99** = ad-hoc casts added to a single date via `show_date_cast_eligibility`. `bookings.offer_tier`
   carries the tier (incl. 99), so close can target a tier's bookings precisely.
8. **Logic lives in tested units.** Supabase reads/writes → `src/data/bookings.ts` (client passed in;
   `createFakeSupabase`); display/format/branch logic → pure helpers in `src/lib/bookings.ts`. The
   component stays thin wiring. Edge functions follow the DI pattern (`handle(req, deps)` + `makeFakeDeps`).

## Architecture & data flow

```
ShowDateDetailSheet — Offers card (canManage && status != 'cancelled')
  │
  ├─ ['offer-tiers','available', showDateId, cityId] → fetchOfferTiers(supabase,{cityId,showDateId})
  │     cast_city_priority.priority WHERE city_id → priorities[];  show_date_cast_eligibility → hasAdHoc
  │     → buildOfferTierOptions({priorities,hasAdHoc})  (pure: dedupe+sort, drop 99, +Ad-hoc)
  │
  ├─ ['offer-tiers','opened', showDateId] → fetchOpenedTiers(supabase, showDateId)
  │     show_date_offer_tiers (tier, opened_at, closed_at) ordered by tier → opened[]
  │     → per row: "Tier N · opened 19 Jun 2026"  (open → [Close] button) | "· closed 20 Jun 2026"
  │
  ├─ OPEN:  Select tier + "Open tier N" (AlertDialogTrigger)
  │     confirm copy = offerConfirmCopy({tier,dateLabel,alreadyOpened})  (pure)
  │     → openOfferTier(supabase,{showDateId,tier})
  │         invoke('open-offer-tier',{body:{show_date_id,tier}}) → {offers_created} | {offers_created:0,message} | {error}
  │     onSuccess: toast[kind](text)=offerResultToast(res,tier); invalidate ['bookings'] + ['offer-tiers','opened',id]
  │     [open-offer-tier now MERGE-upserts the tier row: closed_at=null, opened_at=now, escalation_notified_at=null]
  │
  └─ CLOSE: per open tier, "Close" → controlled AlertDialog with TWO plain-language choices
        pendingCount = pendingOfferCount(bookingsForDate, tier)   (pure: status==='suggested' && offer_tier===tier)
        copy = closeConfirmCopy({tier, pendingCount})   (pure: title, intro, {withdraw|keep}{label,caption})
        choice → closeOfferTier(supabase,{showDateId,tier,withdraw})
            invoke('close-offer-tier',{body:{show_date_id,tier,withdraw}})
              • if withdraw: UPDATE bookings SET status='cancelled',cancelled_at=now,
                  cancellation_reason='tier_closed' WHERE show_date_id AND offer_tier=tier AND status='suggested'  → count
              • UPDATE show_date_offer_tiers SET closed_at=now WHERE show_date_id AND tier
              • → { closed, withdrawn } | { closed:false, message }
        onSuccess: toast[kind](text)=closeResultToast(res,tier); invalidate ['bookings'] + ['offer-tiers','opened',id]
```

## Components

### 1. `close-offer-tier` edge function (new)

`supabase/functions/close-offer-tier/index.ts` — DI pattern, mirroring `open-offer-tier`:

```ts
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;
  if (!isServiceRole(deps, req)) {
    const auth = await requireRole(deps, req, ["admin", "producer"]);
    if (!auth.ok) return auth.response;
  }
  let show_date_id: string, tier: number, withdraw: boolean;
  try {
    const body = await req.json();
    show_date_id = body.show_date_id; tier = Number(body.tier); withdraw = body.withdraw === true;
    if (!show_date_id || !tier || tier < 1) return json({ error: "show_date_id and tier (≥1) are required" }, 400);
  } catch { return json({ error: "Invalid JSON" }, 400); }

  let withdrawn = 0;
  if (withdraw) {
    const { data: cancelled, error: cErr } = await admin
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: deps.now().toISOString(), cancellation_reason: "tier_closed" })
      .eq("show_date_id", show_date_id).eq("offer_tier", tier).eq("status", "suggested")
      .select("id");
    if (cErr) return json({ error: cErr.message }, 500);
    withdrawn = cancelled?.length ?? 0;
  }

  const { data: closedRows, error: clErr } = await admin
    .from("show_date_offer_tiers")
    .update({ closed_at: deps.now().toISOString() })
    .eq("show_date_id", show_date_id).eq("tier", tier).is("closed_at", null)
    .select("id");
  if (clErr) return json({ error: clErr.message }, 500);

  const closed = (closedRows?.length ?? 0) > 0;
  if (!closed && withdrawn === 0) return json({ closed: false, withdrawn: 0, message: "Tier was not open" });
  return json({ closed, withdrawn });
}
```

- **Auth parity with `open-offer-tier`:** `requireRole` (any-org) + service-role bypass. Tightening to
  `requireOrgRole` is deliberately **out of scope** — it would diverge from the sibling function; a
  follow-up could harden both. The admin client bypasses RLS (intentional, like `open-offer-tier`).
- Withdraw targets **only `suggested`** (un-answered) rows — never `soft_booked`/`confirmed`. Cancelling
  fires the existing `sync_show_date_status_trigger` to recompute `show_dates.status` (correct).
- `.is('closed_at', null)` makes re-closing an already-closed tier a benign no-op.
- Benign `{ closed:false, message }` (200) when nothing happened (tier never opened / already closed and
  nothing to withdraw) — surfaced to the producer as an info toast, never an error.

### 2. `open-offer-tier` edit (re-activate on open)

[open-offer-tier/index.ts:181-186](../../../supabase/functions/open-offer-tier/index.ts): replace the
`ignoreDuplicates: true` upsert with a merge that re-activates the tier:

```ts
await (admin as any).from("show_date_offer_tiers").upsert(
  { show_date_id, tier, opened_at: offeredAt.toISOString(), closed_at: null, escalation_notified_at: null },
  { onConflict: "show_date_id,tier" },   // merge (no ignoreDuplicates) → re-open clears closed_at
);
```

No other change to the function (auth, ≥1-session gate, candidate selection, insert all unchanged).

### 3. `src/data/bookings.ts` (new) — Supabase boundary

- `openOfferTier(client, { showDateId, tier }) → { offersCreated, message? }` — invoke
  `open-offer-tier` with `{ show_date_id, tier }`; `if (error) throw error`; if a 200 body carries
  `{ error }` throw it; else return `{ offersCreated: data.offers_created ?? 0, message: data.message }`.
- `fetchOfferTiers(client, { cityId, showDateId }) → { priorities: number[]; hasAdHoc: boolean }` —
  `cast_city_priority.priority` for the city (empty when no city) + `show_date_cast_eligibility` existence.
- `fetchOpenedTiers(client, showDateId) → { tier, openedAt, closedAt }[]` — `show_date_offer_tiers`
  ordered by tier.
- `closeOfferTier(client, { showDateId, tier, withdraw }) → { closed: boolean; withdrawn: number; message? }`
  — invoke `close-offer-tier` with `{ show_date_id, tier, withdraw }`; same error handling as
  `openOfferTier`; return `{ closed: !!data.closed, withdrawn: data.withdrawn ?? 0, message: data.message }`.

### 4. `src/lib/bookings.ts` (extend) — pure helpers

- `buildOfferTierOptions({ priorities, hasAdHoc }) → { value, label }[]` — `Set` dedupe, keep `p>=1 &&
  p!==99`, sort asc → `Tier N`; append `{ value: 99, label: 'Ad-hoc casts' }` when `hasAdHoc`.
- `offerResultToast({ offersCreated, message }, tier) → { kind: 'success'|'info', text }` — `>0` →
  success `Opened {tier} — N offer(s) created`; else info with `message` (fallback "No new offers
  created"). `{tier}` renders as `ad-hoc casts` for 99 else `tier N`.
- `offerConfirmCopy({ tier, dateLabel, alreadyOpened }) → { title, body }` — first-open vs already-opened
  body; tier-99 wording.
- `pendingOfferCount(bookings, tier) → number` — `bookings.filter(b => b.status==='suggested' &&
  b.offer_tier===tier).length`.
- `closeConfirmCopy({ tier, pendingCount }) → { title, intro, withdraw:{label,caption}, keep:{label,caption} }`
  — **jargon-free** copy. `intro`: "Closing stops the reminder and at-risk alerts for {tier}."
  `withdraw.caption` (pendingCount>0): "Cancels the N offer(s) no-one has accepted yet, so those artists
  can't take a spot later. Anyone who already accepted keeps their spot." (and an empty-count variant).
  `keep.caption` (pendingCount>0): "Leaves the N unanswered offer(s) live — artists can still accept
  until the offers expire." (and an empty-count variant).
- `closeResultToast({ closed, withdrawn, message }, tier) → { kind, text }` — `!closed && withdrawn===0`
  → info (`message` ?? "Tier was not open"); `withdrawn>0` → success `Closed {tier} — withdrew N
  offer(s)`; else success `Closed {tier}`.

### 5. `ShowDateDetailSheet.tsx` (edit) — wiring only

Imports: `AlertDialog*` (pattern from `MembersTab`/`OrganizationsTab`), `formatDateDMY`, the four
data-access fns, and the six pure helpers. The close choice needs **no new primitive** — it is rendered
as two explained option buttons inside a **controlled** `AlertDialog`.

New `canManage && showDate.status !== 'cancelled'` **Offers card** above "Assigned Artists":
- Queries `tiersQ` (`['offer-tiers','available',…]`) and `openedQ` (`['offer-tiers','opened',…]`); both
  `enabled: canManage && !!showDateId`.
- `options = buildOfferTierOptions(tiersQ.data ?? {priorities:[],hasAdHoc:false})`;
  `effectiveTier = selectedTier ?? options[0]?.value ?? null`;
  `hasSession = !!(session_1||session_2||session_3)`;
  `alreadyOpened = (openedQ.data??[]).some(o => o.tier===effectiveTier && !o.closedAt)`.
- **Opened-tiers display:** `openedQ.data` → one badge per row: label `o.tier===99 ? 'Ad-hoc casts' :
  \`Tier ${o.tier}\``, suffix `· opened ${formatDateDMY(o.openedAt)}` (or `· closed
  ${formatDateDMY(o.closedAt)}`). Open rows (`!closedAt`) also render a small **Close** button. Empty →
  muted "No tiers opened yet.".
- **Open control:** `options.length===0` → muted helper "No offer tiers configured for this city — set
  cast priorities in Settings → Cities & Casts."; else `Select` (value `String(effectiveTier)`) + an
  `AlertDialog` whose trigger button `Open {tier}` is `disabled={!hasSession || openOffers.isPending}`
  (muted "Add a session time before opening offers." when `!hasSession`); title/body from
  `offerConfirmCopy`; `AlertDialogAction` → `openOffers.mutate()`.
- **Close dialog (controlled):** local `{ open, tier }` state; opened by a tier's Close button. Body =
  `closeConfirmCopy({ tier, pendingCount: pendingOfferCount(bookingsForDate ?? [], tier) })` rendered as
  intro + two option buttons (Withdraw / Keep) each with its caption; clicking either calls
  `closeOffers.mutate({ tier, withdraw })` then closes the dialog; `AlertDialogCancel` "Cancel".
- **Mutations:**
  - `openOffers`: `mutationFn: () => openOfferTier(supabase,{showDateId,tier:effectiveTier!})`;
    onSuccess → `offerResultToast` toast + invalidate `['bookings']` and `['offer-tiers','opened',id]`;
    onError → `toast.error`.
  - `closeOffers`: `mutationFn: ({tier,withdraw}) => closeOfferTier(supabase,{showDateId,tier,withdraw})`;
    onSuccess → `closeResultToast` toast + same invalidations; onError → `toast.error`.

No change to the cancelled-banner / slots / date-config / assigned-artists / chat sections.

## Testing strategy (test-first)

Dev machine is **Deno-only**; vitest/tsc/eslint run in **CI**. The edge functions are Deno-testable
**locally**.

| Layer | File | Covers |
|---|---|---|
| Edge (Deno, local) | `supabase/functions/close-offer-tier/index.di.test.ts` (new) | OPTIONS preflight; no-auth → 401; bad/missing body → 400; `withdraw:true` cancels only `suggested` rows for the tier (status/cancelled_at/reason in the recorded update; count returned) and leaves soft_booked/confirmed; `withdraw:false` cancels nothing; closes the tier (`closed_at` update with `.is('closed_at',null)`); tier never open + no withdraw → benign `{closed:false,message}`; service-role bypass. |
| Edge (Deno, local) | `supabase/functions/open-offer-tier/index.di.test.ts` (extend) | the tier upsert now merges with `closed_at:null` + `escalation_notified_at:null` (re-activation); existing happy-path/guard tests stay green. |
| Data-access (vitest, CI) | `src/data/bookings.test.ts` (new) | `openOfferTier`/`closeOfferTier` send the right body and parse results; throw on transport `error` and on a 200 `{error}`. `fetchOfferTiers` (priorities + hasAdHoc; no-city). `fetchOpenedTiers` maps + orders. |
| Pure helpers (vitest, CI) | `src/lib/bookings.test.ts` (extend) | `buildOfferTierOptions` (dedupe/sort/drop-99/ad-hoc/empty); `offerResultToast` (singular/plural, info+message); `offerConfirmCopy` (first vs re-open, 99); `pendingOfferCount`; `closeConfirmCopy` (count>0 vs 0, 99 wording); `closeResultToast` (withdrew N / closed / not-open). |

**No full-component test for `ShowDateDetailSheet`:** its other queries call the `supabase` singleton
inline (not data-access fns), so a render test would hit the real client — and mocking the client is
against repo convention (CLAUDE.md: "never `vi.mock` the client"). The new behavior is fully covered by
the edge-function, data-access, and pure-helper units; the component is thin wiring. Manual verification
in the running app + CI green is the acceptance bar.

## Risks & edge cases

- **`functions.invoke` non-2xx message** — supabase-js returns a generic `FunctionsHttpError` (body in
  `error.context`); true errors toast a generic message. Reachable outcomes from this UI are 200
  (happy / benign-skip), so acceptable; benign skips carry an explicit `message` shown via info toast.
- **Withdraw is destructive but guarded** — only `suggested` rows, only the chosen tier, behind a
  dialog that states the exact count and that accepted artists keep their slot. Cancelled rows are
  recoverable by re-opening (they become free candidates again).
- **Re-open after close** — the merged upsert clears `closed_at`/`escalation_notified_at` and refreshes
  `opened_at`, so a re-opened tier is fully active again and can re-escalate. Verified by the extended
  open-offer-tier Deno test.
- **Stale selected tier** — `effectiveTier` falls back to the first option; a city change can't leave a
  non-existent tier selected.
- **Suggested rows appear/disappear immediately** — `deriveBookingGroups` treats `suggested` as active,
  so opening repopulates and withdrawing removes rows from "Assigned Artists" after `['bookings']`
  invalidation.
- **Auth breadth** — `close-offer-tier` mirrors `open-offer-tier`'s any-org `requireRole` + service-role
  bypass; not tightened here (parity), noted as a possible cross-cutting follow-up.
- **Query-key domains** — `['offer-tiers', …]` reads config/state tables (not `bookings`); the opened
  key is invalidated explicitly on open/close. `['bookings']` follows the CLAUDE.md prefix rule.

## File touch-list

- `supabase/functions/close-offer-tier/index.ts` (new) + `index.di.test.ts` (new).
- `supabase/functions/open-offer-tier/index.ts` (edit: merge upsert) + `index.di.test.ts` (extend).
- `src/data/bookings.ts` (new) — `openOfferTier`, `fetchOfferTiers`, `fetchOpenedTiers`, `closeOfferTier`.
- `src/data/bookings.test.ts` (new).
- `src/lib/bookings.ts` (extend) — `buildOfferTierOptions`, `offerResultToast`, `offerConfirmCopy`,
  `pendingOfferCount`, `closeConfirmCopy`, `closeResultToast`.
- `src/lib/bookings.test.ts` (extend).
- `src/components/shows/ShowDateDetailSheet.tsx` (edit) — Offers card (open + opened-tiers + close).

No DB migration (uses existing `closed_at` / booking columns); no `types.ts` change.

## Non-goals (YAGNI)

- No escalation/at-risk automation changes beyond honoring `closed_at` (already honored).
- No surfacing of `escalation_notified_at` / `opened_by` in the badges.
- No "re-open closed" as a distinct button — re-opening is the existing Open action (now re-activating).
- No tightening of `open`/`close` auth to org-scoped (parity follow-up).
- No confirmation "don't ask again" preference; no refactor of the sheet's other inline queries.
