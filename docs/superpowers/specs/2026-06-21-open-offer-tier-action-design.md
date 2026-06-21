# Open offer tier — producer/admin action in ShowDateDetailSheet — design

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
is the booking engine's ignition: it creates `suggested` bookings for a `(show_date, tier)`. It is
**already authorized for `admin`/`producer`** callers (`requireRole(['admin','producer'])` for
non-service-role) and **already enforces the ≥1-session gate** (a zero-session date returns a benign
`{ offers_created: 0, message: 'Show date has no sessions yet — offers not opened' }`). But **nothing
in the frontend invokes it** — today it only auto-fires from `airtable-poll` for newly-imported dates,
tier 1 only. Consequences:

- **Revival dead-end** (PR #107 reviewer #5): a date cancelled in Airtable and later un-cancelled
  returns to `status='open'` with **no bookings** and no way to restart offers.
- **Non-Airtable orgs** can't start the booking flow from the UI at all.

**Goal:** add a producer/admin **"Open offer tier"** action to the date detail surface
[ShowDateDetailSheet.tsx](../../../src/components/shows/ShowDateDetailSheet.tsx) that invokes
`open-offer-tier` for the current `show_date`, lets the user choose the tier behind a **confirmation
dialog**, **displays already-opened tiers**, surfaces the result via a `sonner` toast, and invalidates
the `['bookings']` query domain.

## Decisions (locked in brainstorming)

1. **Frontend-only.** `open-offer-tier` needs **no change** — admin/producer auth and the ≥1-session
   benign-skip already shipped (the latter via the sibling schedule-change-notifications task,
   Component 2). The UI mirrors those guards for good UX and surfaces the function's `message`.
2. **Guided Offers card.** A new `canManage`-only card above "Assigned Artists", with a **data-driven**
   tier dropdown that lists only tiers that actually have casts for this date's city, plus an
   **Ad-hoc casts (tier 99)** option when per-date casts exist. (Chosen over a fixed `1/2/3` dropdown
   or a free number input — honest tier list, best fit for the revival case: empty assigned list +
   obvious affordance.)
3. **Tier model** (verified in code): tiers 1..N come from `cast_city_priority.priority` (per cast,
   per city); **tier 99** is the ad-hoc convention for casts added to a single date via
   `show_date_cast_eligibility` (no `cast_city_priority` row). `open-offer-tier` resolves both.
4. **Confirmation before opening.** Opening offers fans out suggested bookings (emailed later via the
   daily digest), so the action goes behind a shadcn `AlertDialog`. The dialog copy explains what
   happens and, when re-opening an already-opened tier, that re-open is **additive** (the function
   pre-filters artists who already have an offer/booking — re-opening is idempotent and
   non-destructive).
5. **Display already-opened tiers.** Read `show_date_offer_tiers` and show which tiers were opened
   (with date), so the producer sees pipeline state and understands escalation / re-open. Read-only.
6. **Logic lives in tested units.** New Supabase reads/writes go in `src/data/bookings.ts` (client
   passed in; tested with `createFakeSupabase`); display/format/branch logic goes in pure helpers in
   `src/lib/bookings.ts` (tested in `bookings.test.ts`). The component stays thin wiring — matching the
   repo's data-access-extraction convention.

## Architecture & data flow

```
ShowDateDetailSheet (canManage only, date not cancelled)
  │
  ├─ useQuery ['offer-tiers','available', showDateId, cityId]
  │     → fetchOfferTiers(supabase, {cityId, showDateId})
  │         • cast_city_priority.priority WHERE city_id = cityId   → priorities[]
  │         • show_date_cast_eligibility EXISTS WHERE show_date_id → hasAdHoc
  │     → buildOfferTierOptions({priorities, hasAdHoc})  (pure: dedupe+sort, +Ad-hoc)
  │
  ├─ useQuery ['offer-tiers','opened', showDateId]
  │     → fetchOpenedTiers(supabase, showDateId)
  │         • show_date_offer_tiers (tier, opened_at, closed_at)   → opened[]
  │     → render badges: "Tier 1 · opened 19 Jun 2026"  (formatDateDMY)
  │
  └─ Tier <Select> + "Open tier N" button (= AlertDialogTrigger)
        │  button disabled when: no session | mutation pending
        ▼
     <AlertDialog>  title/body = offerConfirmCopy({tier, dateLabel, alreadyOpened})  (pure)
        │  AlertDialogAction →
        ▼
     useMutation → openOfferTier(supabase, {showDateId, tier})
        • supabase.functions.invoke('open-offer-tier', { body: { show_date_id, tier } })
        • throws on transport/non-2xx error or a 200 body carrying { error }
        • returns { offersCreated, message? }
        ▼
     onSuccess:  toast[kind](text)   where {kind,text} = offerResultToast(result, tier)  (pure)
                 invalidate ['bookings']                  → Assigned Artists shows new suggested rows
                 invalidate ['offer-tiers','opened', showDateId]  → opened badges refresh
     onError:    toast.error(err.message)
```

`open-offer-tier` response shapes the UI consumes (verified in the function):
- **Happy path:** `200 { offers_created: N }` → success toast.
- **Benign skip:** `200 { offers_created: 0, message }` (no city / no casts at tier / all already
  offered or blocked / no sessions) → **info** toast carrying `message`.
- **Error:** non-2xx `{ error }` (cancelled date / bad input / not found / insert failure) →
  `supabase.functions.invoke` returns a `FunctionsHttpError`; `toast.error` shows its (generic)
  message. These are essentially unreachable from this UI (card hidden when cancelled; `show_date_id`
  + `tier` always valid), so the generic message is acceptable rather than parsing `error.context`.

## Components

### 1. `src/data/bookings.ts` (new) — Supabase boundary

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface OpenOfferTierResult { offersCreated: number; message?: string }

/** Invoke the open-offer-tier edge function for one (show_date, tier). */
export async function openOfferTier(
  client: SupabaseClient<Database>,
  { showDateId, tier }: { showDateId: string; tier: number },
): Promise<OpenOfferTierResult> {
  const { data, error } = await client.functions.invoke("open-offer-tier", {
    body: { show_date_id: showDateId, tier },
  });
  if (error) throw error;
  const payload = data as { offers_created?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { offersCreated: payload?.offers_created ?? 0, message: payload?.message };
}

/** Tiers that *can* be opened for a date: city priorities + ad-hoc presence. */
export async function fetchOfferTiers(
  client: SupabaseClient<Database>,
  { cityId, showDateId }: { cityId: string | null; showDateId: string },
): Promise<{ priorities: number[]; hasAdHoc: boolean }> {
  let priorities: number[] = [];
  if (cityId) {
    const { data, error } = await client
      .from("cast_city_priority").select("priority").eq("city_id", cityId);
    if (error) throw error;
    priorities = (data ?? []).map((r) => r.priority as number);
  }
  const { data: adHoc, error: adErr } = await client
    .from("show_date_cast_eligibility").select("id").eq("show_date_id", showDateId).limit(1);
  if (adErr) throw adErr;
  return { priorities, hasAdHoc: (adHoc ?? []).length > 0 };
}

export interface OpenedTier { tier: number; openedAt: string; closedAt: string | null }

/** Tiers that *have* been opened for a date (read-only state display). */
export async function fetchOpenedTiers(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<OpenedTier[]> {
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select("tier, opened_at, closed_at")
    .eq("show_date_id", showDateId)
    .order("tier", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ tier: r.tier, openedAt: r.opened_at, closedAt: r.closed_at }));
}
```

### 2. `src/lib/bookings.ts` (extend) — pure helpers

```ts
export interface OfferTierOption { value: number; label: string }

/** Build the tier dropdown options: deduped+sorted city tiers, then Ad-hoc(99) when present.
 *  99 is reserved for ad-hoc, so it is filtered out of priority-derived tiers. */
export function buildOfferTierOptions(
  { priorities, hasAdHoc }: { priorities: number[]; hasAdHoc: boolean },
): OfferTierOption[] {
  const uniq = Array.from(new Set(priorities))
    .filter((p) => Number.isFinite(p) && p >= 1 && p !== 99)
    .sort((a, b) => a - b);
  const opts = uniq.map((p) => ({ value: p, label: `Tier ${p}` }));
  if (hasAdHoc) opts.push({ value: 99, label: "Ad-hoc casts" });
  return opts;
}

/** Map an open-offer-tier result to a toast kind + text. */
export function offerResultToast(
  result: { offersCreated: number; message?: string },
  tier: number,
): { kind: "success" | "info"; text: string } {
  const t = tier === 99 ? "ad-hoc casts" : `tier ${tier}`;
  if (result.offersCreated > 0) {
    const n = result.offersCreated;
    return { kind: "success", text: `Opened ${t} — ${n} offer${n === 1 ? "" : "s"} created` };
  }
  return { kind: "info", text: result.message ?? "No new offers created" };
}

/** Confirmation-dialog copy; re-open branch explains the additive semantics. */
export function offerConfirmCopy(
  { tier, dateLabel, alreadyOpened }: { tier: number; dateLabel: string; alreadyOpened: boolean },
): { title: string; body: string } {
  const t = tier === 99 ? "ad-hoc casts" : `tier ${tier}`;
  const Cap = tier === 99 ? "Ad-hoc casts have" : `Tier ${tier} has`;
  const base =
    `This creates suggested bookings for all eligible artists in ${t} for ${dateLabel}. ` +
    `They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.`;
  const reopen = alreadyOpened
    ? ` ${Cap} already been opened — re-opening only adds offers for artists who don't have one yet.`
    : "";
  return { title: `Open ${t} offers?`, body: base + reopen };
}
```

### 3. `ShowDateDetailSheet.tsx` (edit) — wiring only

Add `AlertDialog*` to the `@/components/ui/alert-dialog` import (pattern already used in
`MembersTab`/`OrganizationsTab`), `formatDateDMY` from `@/lib/dates`, the three data-access fns, and
the three pure helpers.

Inside the `canManage && showDate.status !== 'cancelled'` block, above "Assigned Artists":

- `tiersQ = useQuery({ queryKey: ['offer-tiers','available', showDateId, cityId], enabled: canManage && !!showDateId, queryFn: () => fetchOfferTiers(supabase, { cityId, showDateId: showDateId! }) })`
- `openedQ = useQuery({ queryKey: ['offer-tiers','opened', showDateId], enabled: canManage && !!showDateId, queryFn: () => fetchOpenedTiers(supabase, showDateId!) })`
- `const options = buildOfferTierOptions(tiersQ.data ?? { priorities: [], hasAdHoc: false })`
- `const [selectedTier, setSelectedTier] = useState<number | null>(null)`;
  `const effectiveTier = selectedTier ?? options[0]?.value ?? null` (avoids stale state while options load).
- `const hasSession = !!(showDate.session_1 || showDate.session_2 || showDate.session_3)`
- `const alreadyOpened = (openedQ.data ?? []).some(o => o.tier === effectiveTier)`
- `openOffers = useMutation({ mutationFn: () => openOfferTier(supabase, { showDateId: showDateId!, tier: effectiveTier! }), onSuccess: (res) => { const {kind,text} = offerResultToast(res, effectiveTier!); toast[kind](text); queryClient.invalidateQueries({ queryKey: ['bookings'] }); queryClient.invalidateQueries({ queryKey: ['offer-tiers','opened', showDateId] }); }, onError: (e:any) => toast.error(e.message) })`

Card body:
- **Opened tiers:** `openedQ.data` → one badge per row: label `o.tier === 99 ? 'Ad-hoc casts' : `Tier ${o.tier}``, suffixed `· opened ${formatDateDMY(o.openedAt)}` (or `· closed ${formatDateDMY(o.closedAt)}` when set). Empty → muted "No tiers opened yet.".
- **Open control:** if `options.length === 0` → muted helper "No offer tiers configured for this city — set cast priorities in Settings → Cities & Casts."; else a `Select` (value `String(effectiveTier)`, options mapped) + an `AlertDialog`:
  - Trigger = `Button` labelled `` `Open ${effectiveTier === 99 ? 'ad-hoc casts' : 'tier ' + effectiveTier}` ``, `disabled={!hasSession || openOffers.isPending}`.
  - When `!hasSession`: render a muted helper "Add a session time before opening offers." next to the disabled button.
  - Content title/description from `offerConfirmCopy({ tier: effectiveTier, dateLabel: formatDateDMY(showDate.date), alreadyOpened })`.
  - `AlertDialogAction onClick={() => openOffers.mutate()}` labelled "Open offers"; `AlertDialogCancel` "Cancel".

No change to the existing cancelled-banner / slots / date-config / assigned-artists / chat sections.

## Testing strategy (test-first)

Local machine is **Deno-only**; vitest/tsc/eslint run in **CI** (`.github/workflows/ci.yml`). The
edge function is untouched (its session/auth tests already exist in `open-offer-tier/index.di.test.ts`),
so there is no new Deno test. New coverage is vitest, verified in CI.

| Layer | File | Covers |
|---|---|---|
| Data-access (vitest) | `src/data/bookings.test.ts` (new) | `openOfferTier` sends `{ show_date_id, tier }` and returns `offersCreated`/`message`; throws on transport `error`; throws on a 200 body `{ error }`. `fetchOfferTiers` returns `priorities` for the city + `hasAdHoc`; no city → `priorities: []`. `fetchOpenedTiers` maps rows to `{ tier, openedAt, closedAt }` ordered by tier. |
| Pure helpers (vitest) | `src/lib/bookings.test.ts` (extend) | `buildOfferTierOptions` dedupes+sorts, drops 99 from priorities, appends Ad-hoc only when `hasAdHoc`, empty in → `[]`. `offerResultToast`: >0 → success with singular/plural "offer(s)"; 0 → info with message (and fallback). `offerConfirmCopy`: first-open vs already-opened body; tier-99 wording. |

**No full-component test for `ShowDateDetailSheet`:** its other queries call the `supabase` singleton
inline (not data-access fns), so a render test would hit the real client — and mocking the client is
against repo convention (CLAUDE.md: "never `vi.mock` the client"). The new behavior is fully covered by
the data-access + pure-helper units above; the component is thin wiring over them. Manual verification
in the running app + CI green is the acceptance bar.

## Risks & edge cases

- **`functions.invoke` non-2xx error message** — supabase-js returns a generic `FunctionsHttpError`
  (body in `error.context`), so true errors toast a generic message. Accepted: the UI hides the card
  when cancelled and always sends valid input, so reachable outcomes are 200 (happy / benign-skip).
- **Benign skips look like "nothing happened"** — surfaced explicitly via the **info** toast carrying
  the function's `message` (e.g. "No casts configured at tier 2 for this city").
- **Re-opening a tier** — non-destructive: the function pre-filters artists with an existing
  offer/booking, so re-open only adds genuinely-missing offers; the confirm dialog says so.
- **Stale selected tier** — `effectiveTier` falls back to the first option, so a city change that
  reshapes options can't leave a tier selected that no longer exists.
- **No city / no priorities / no ad-hoc** — `options` is empty → helper text instead of a dead button.
- **Suggested rows appear immediately** — `deriveBookingGroups` treats `suggested` as active, so the
  invalidated `['bookings']` query repopulates "Assigned Artists" right after opening.
- **Query-key domains** — `['offer-tiers', …]` reads config/state tables (not `bookings`), so it is a
  separate domain; the opened-tiers key is invalidated explicitly on success. `['bookings']` follows
  the CLAUDE.md prefix-invalidation rule.

## File touch-list

- `src/data/bookings.ts` (new) — `openOfferTier`, `fetchOfferTiers`, `fetchOpenedTiers`.
- `src/data/bookings.test.ts` (new) — data-access tests with `createFakeSupabase`.
- `src/lib/bookings.ts` (extend) — `buildOfferTierOptions`, `offerResultToast`, `offerConfirmCopy`.
- `src/lib/bookings.test.ts` (extend) — pure-helper tests.
- `src/components/shows/ShowDateDetailSheet.tsx` (edit) — Offers card (opened-tiers display + tier
  Select + confirm dialog + mutation/invalidation).

## Non-goals (YAGNI)

- No edge-function change (auth + ≥1-session benign-skip already shipped).
- No "close tier" / escalation automation — opened-tiers display is read-only.
- No surfacing of `escalation_notified_at` / `opened_by` in the badges.
- No confirmation-dialog "don't ask again" preference.
- No refactor of the sheet's other inline `supabase` queries into data-access (out of scope).
