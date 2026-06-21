# Offer-Tier Actions (Open / Close) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give producers/admins a guided "Offers" card in `ShowDateDetailSheet` to open an offer tier (with confirmation), see already-opened tiers, and close an open tier — choosing at close-time whether to withdraw unanswered offers.

**Architecture:** A new edge function `close-offer-tier` (mirrors `open-offer-tier`) sets `show_date_offer_tiers.closed_at` and optionally cancels the tier's still-`suggested` bookings. `open-offer-tier` is adjusted so re-opening re-activates a closed tier. The frontend routes all new Supabase calls through `src/data/bookings.ts` (testable with the fake client) and keeps branch/format/copy logic in pure helpers in `src/lib/bookings.ts`; the component is thin wiring.

**Tech Stack:** Deno edge functions (DI `handle(req, deps)` + `makeFakeDeps`), React 18 + TanStack Query v5, shadcn/ui (`AlertDialog`, `Select`), sonner toasts, Vitest + `createFakeSupabase`.

**Environment note:** The dev machine is **Deno-only**. Edge-function tests (Tasks 1–2) run locally via `deno test`. Vitest tests (Tasks 3–4) and `tsc`/`eslint` (Task 5) run in **CI** — write the test first regardless, then rely on CI to confirm red→green for those tasks.

**Spec:** `docs/superpowers/specs/2026-06-21-open-offer-tier-action-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/open-offer-tier/index.ts` (modify) | Merge-upsert the tier row so re-open clears `closed_at`/`escalation_notified_at`. |
| `supabase/functions/open-offer-tier/index.di.test.ts` (modify) | Add re-activation assertion. |
| `supabase/functions/close-offer-tier/index.ts` (create) | Close a tier: set `closed_at`; if `withdraw`, cancel its `suggested` bookings. |
| `supabase/functions/close-offer-tier/index.di.test.ts` (create) | Full contract coverage. |
| `src/lib/bookings.ts` (modify) | Pure helpers: `buildOfferTierOptions`, `offerResultToast`, `offerConfirmCopy`, `pendingOfferCount`, `closeConfirmCopy`, `closeResultToast`. |
| `src/lib/bookings.test.ts` (modify) | Unit tests for the six helpers. |
| `src/data/bookings.ts` (create) | Data-access: `openOfferTier`, `fetchOfferTiers`, `fetchOpenedTiers`, `closeOfferTier`. |
| `src/data/bookings.test.ts` (create) | Data-access tests with `createFakeSupabase`. |
| `src/components/shows/ShowDateDetailSheet.tsx` (modify) | "Offers" card: opened-tiers display + open control + close dialog. |

---

## Task 1: `open-offer-tier` re-activates a closed tier

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts:181-186`
- Test: `supabase/functions/open-offer-tier/index.di.test.ts`

- [ ] **Step 1: Add the failing re-activation test**

Append to `supabase/functions/open-offer-tier/index.di.test.ts`:

```ts
// ------ Re-open re-activates a closed tier (merge upsert) ------

Deno.test("open-offer-tier: tier upsert merges closed_at:null + escalation_notified_at:null", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);

  const upsertCall = calls.find(
    (c) => c.table === "show_date_offer_tiers" && c.method === "upsert"
  );
  assertExists(upsertCall, "show_date_offer_tiers upsert must be recorded");
  const data = upsertCall!.args[0] as Record<string, unknown>;
  assertEquals(data.closed_at, null, "re-open must clear closed_at");
  assertEquals(data.escalation_notified_at, null, "re-open must reset escalation_notified_at");
  assertEquals(data.opened_at, fixedNow.toISOString());

  const opts = upsertCall!.args[1] as Record<string, unknown>;
  assertEquals(opts.onConflict, "show_date_id,tier");
  assertEquals("ignoreDuplicates" in opts, false, "merge upsert must not ignore duplicates");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all supabase/functions/open-offer-tier/index.di.test.ts`
Expected: FAIL — the new test reports `closed_at` is `undefined` (not `null`) and `ignoreDuplicates` is present.

- [ ] **Step 3: Implement the merge upsert**

In `supabase/functions/open-offer-tier/index.ts`, replace the existing upsert (currently lines ~181-186):

```ts
  // show_date_offer_tiers has a UNIQUE (show_date_id, tier) constraint, so
  // the upsert is safe here.
  await (admin as any)
    .from('show_date_offer_tiers')
    .upsert(
      { show_date_id, tier, opened_at: offeredAt.toISOString() },
      { onConflict: 'show_date_id,tier', ignoreDuplicates: true }
    )
```

with (a merge upsert that re-activates a previously-closed tier):

```ts
  // show_date_offer_tiers has a UNIQUE (show_date_id, tier) constraint. A MERGE
  // upsert (no ignoreDuplicates) re-activates a tier that was previously closed:
  // clears closed_at, refreshes opened_at, and resets escalation so the new
  // round can escalate again. (close-offer-tier sets closed_at.)
  await (admin as any)
    .from('show_date_offer_tiers')
    .upsert(
      {
        show_date_id,
        tier,
        opened_at: offeredAt.toISOString(),
        closed_at: null,
        escalation_notified_at: null,
      },
      { onConflict: 'show_date_id,tier' }
    )
```

- [ ] **Step 4: Run the whole `open-offer-tier` suite**

Run: `deno test --allow-all supabase/functions/open-offer-tier/index.di.test.ts`
Expected: PASS — the new test plus all pre-existing tests (including "upserts show_date_offer_tiers with correct shape") pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/open-offer-tier/index.ts supabase/functions/open-offer-tier/index.di.test.ts
git commit -m "feat(offers): re-open re-activates a closed offer tier"
```

---

## Task 2: `close-offer-tier` edge function

**Files:**
- Create: `supabase/functions/close-offer-tier/index.ts`
- Test: `supabase/functions/close-offer-tier/index.di.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `supabase/functions/close-offer-tier/index.di.test.ts`:

```ts
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SVC = { Authorization: "Bearer svc" };
const envVars = { SUPABASE_SERVICE_ROLE_KEY: "svc" };
const NOW = new Date("2026-07-01T10:00:00.000Z");

Deno.test("close-offer-tier: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("close-offer-tier: no auth → 401", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("close-offer-tier: missing fields → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("close-offer-tier: invalid JSON → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { ...SVC, "Content-Type": "application/json" },
    body: "not json",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 400);
});

Deno.test("close-offer-tier: withdraw:false closes tier, withdraws nothing", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: NOW,
    tables: { show_date_offer_tiers: { data: [{ id: "t1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { closed: true, withdrawn: 0 });

  const bookingsUpdate = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(bookingsUpdate, undefined, "no bookings update when withdraw:false");

  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate);
  assertEquals((tierUpdate!.args[0] as Record<string, unknown>).closed_at, NOW.toISOString());
});

Deno.test("close-offer-tier: withdraw:true cancels suggested rows (payload + count + filters)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: NOW,
    tables: {
      bookings: { data: [{ id: "b1" }, { id: "b2" }], error: null },
      show_date_offer_tiers: { data: [{ id: "t1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 2, withdraw: true } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { closed: true, withdrawn: 2 });

  const bookingsUpdate = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(bookingsUpdate);
  const payload = bookingsUpdate!.args[0] as Record<string, unknown>;
  assertEquals(payload.status, "cancelled");
  assertEquals(payload.cancellation_reason, "tier_closed");
  assertEquals(payload.cancelled_at, NOW.toISOString());

  const eqArgs = calls.filter((c) => c.table === "bookings" && c.method === "eq").map((c) => c.args);
  assertEquals(eqArgs.some((a) => a[0] === "show_date_id" && a[1] === "d1"), true);
  assertEquals(eqArgs.some((a) => a[0] === "offer_tier" && a[1] === 2), true);
  assertEquals(eqArgs.some((a) => a[0] === "status" && a[1] === "suggested"), true);
});

Deno.test("close-offer-tier: tier not open + no withdraw → benign closed:false", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_date_offer_tiers: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.closed, false);
  assertEquals(body.withdrawn, 0);
  assertExists(body.message);
});

Deno.test("close-offer-tier: close-tier DB error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_date_offer_tiers: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 500);
  assertExists((await res.json()).error);
});

Deno.test("close-offer-tier: withdraw DB error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { bookings: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: true } }), deps);
  assertEquals(res.status, 500);
  assertExists((await res.json()).error);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all supabase/functions/close-offer-tier/index.di.test.ts`
Expected: FAIL — `Module not found` for `./index.ts` (handler doesn't exist yet).

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/close-offer-tier/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Close an offer tier for a show date.
 *   - Always: stamp show_date_offer_tiers.closed_at (stops escalation + at-risk alerts).
 *   - withdraw=true: also cancel the tier's still-'suggested' (un-answered) bookings
 *     (mirrors expire_soft_bookings: status='cancelled', cancellation_reason='tier_closed').
 *     soft_booked/confirmed bookings are never touched.
 *
 * Auth: service-role bypass, else requireRole(['admin','producer']) — mirrors open-offer-tier.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  if (!isServiceRole(deps, req)) {
    const auth = await requireRole(deps, req, ["admin", "producer"]);
    if (!auth.ok) return auth.response;
  }

  let show_date_id: string;
  let tier: number;
  let withdraw: boolean;
  try {
    const body = await req.json();
    show_date_id = body.show_date_id;
    tier = Number(body.tier);
    withdraw = body.withdraw === true;
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: "show_date_id and tier (≥1) are required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  let withdrawn = 0;
  if (withdraw) {
    const { data: cancelled, error: cErr } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: deps.now().toISOString(),
        cancellation_reason: "tier_closed",
      })
      .eq("show_date_id", show_date_id)
      .eq("offer_tier", tier)
      .eq("status", "suggested")
      .select("id");
    if (cErr) {
      console.error("close-offer-tier: withdraw error", cErr);
      return json({ error: cErr.message }, 500);
    }
    withdrawn = cancelled?.length ?? 0;
  }

  const { data: closedRows, error: clErr } = await (admin as any)
    .from("show_date_offer_tiers")
    .update({ closed_at: deps.now().toISOString() })
    .eq("show_date_id", show_date_id)
    .eq("tier", tier)
    .is("closed_at", null)
    .select("id");
  if (clErr) {
    console.error("close-offer-tier: close error", clErr);
    return json({ error: clErr.message }, 500);
  }

  const closed = (closedRows?.length ?? 0) > 0;
  if (!closed && withdrawn === 0) {
    return json({ closed: false, withdrawn: 0, message: "Tier was not open" });
  }
  console.log("close-offer-tier complete", { show_date_id, tier, withdraw, withdrawn, closed });
  return json({ closed, withdrawn });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all supabase/functions/close-offer-tier/index.di.test.ts`
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Run the whole edge-function suite (regression guard)**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS — no regressions across the suite.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/close-offer-tier/
git commit -m "feat(offers): add close-offer-tier edge function"
```

---

## Task 3: Pure helpers in `src/lib/bookings.ts`

**Files:**
- Modify: `src/lib/bookings.ts`
- Test: `src/lib/bookings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/bookings.test.ts` (and extend the top import line — see Step 3):

```ts
import {
  buildOfferTierOptions,
  offerResultToast,
  offerConfirmCopy,
  pendingOfferCount,
  closeConfirmCopy,
  closeResultToast,
} from "./bookings";

describe("buildOfferTierOptions", () => {
  it("dedupes, sorts ascending, and labels tiers", () => {
    expect(buildOfferTierOptions({ priorities: [2, 1, 2], hasAdHoc: false })).toEqual([
      { value: 1, label: "Tier 1" },
      { value: 2, label: "Tier 2" },
    ]);
  });
  it("drops priorities below 1 and any stray 99, then appends Ad-hoc when present", () => {
    expect(buildOfferTierOptions({ priorities: [0, 1, 99], hasAdHoc: true })).toEqual([
      { value: 1, label: "Tier 1" },
      { value: 99, label: "Ad-hoc casts" },
    ]);
  });
  it("returns empty when no priorities and no ad-hoc", () => {
    expect(buildOfferTierOptions({ priorities: [], hasAdHoc: false })).toEqual([]);
  });
});

describe("offerResultToast", () => {
  it("success with pluralized count when offers created", () => {
    expect(offerResultToast({ offersCreated: 2 }, 1)).toEqual({ kind: "success", text: "Opened tier 1 — 2 offers created" });
    expect(offerResultToast({ offersCreated: 1 }, 1)).toEqual({ kind: "success", text: "Opened tier 1 — 1 offer created" });
  });
  it("info with backend message when nothing created", () => {
    expect(offerResultToast({ offersCreated: 0, message: "No casts at tier 2 for this city" }, 2))
      .toEqual({ kind: "info", text: "No casts at tier 2 for this city" });
  });
  it("info with fallback when no message", () => {
    expect(offerResultToast({ offersCreated: 0 }, 99)).toEqual({ kind: "info", text: "No new offers created" });
  });
});

describe("offerConfirmCopy", () => {
  it("first-open body has no re-open note", () => {
    const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false });
    expect(c.title).toBe("Open tier 1 offers?");
    expect(c.body).toContain("10 Jul 2026");
    expect(c.body).not.toContain("already been opened");
  });
  it("already-opened body adds the additive re-open note", () => {
    const c = offerConfirmCopy({ tier: 2, dateLabel: "10 Jul 2026", alreadyOpened: true });
    expect(c.body).toContain("Tier 2 has already been opened");
  });
  it("uses ad-hoc wording for tier 99", () => {
    const c = offerConfirmCopy({ tier: 99, dateLabel: "10 Jul 2026", alreadyOpened: true });
    expect(c.title).toBe("Open ad-hoc casts offers?");
    expect(c.body).toContain("Ad-hoc casts have already been opened");
  });
});

describe("pendingOfferCount", () => {
  it("counts only suggested bookings for the given tier", () => {
    const rows = [
      { status: "suggested", offer_tier: 1 },
      { status: "suggested", offer_tier: 1 },
      { status: "soft_booked", offer_tier: 1 },
      { status: "suggested", offer_tier: 2 },
    ];
    expect(pendingOfferCount(rows, 1)).toBe(2);
    expect(pendingOfferCount(rows, 2)).toBe(1);
    expect(pendingOfferCount(rows, 3)).toBe(0);
  });
});

describe("closeConfirmCopy", () => {
  it("withdraw caption names the pending count; both options explained", () => {
    const c = closeConfirmCopy({ tier: 1, pendingCount: 3 });
    expect(c.title).toBe("Close tier 1?");
    expect(c.intro).toContain("stops the reminder");
    expect(c.withdraw.caption).toContain("3 offers");
    expect(c.keep.caption).toContain("3 unanswered offers");
  });
  it("zero pending uses the empty-count phrasing", () => {
    const c = closeConfirmCopy({ tier: 2, pendingCount: 0 });
    expect(c.withdraw.caption).toContain("No unanswered offers");
    expect(c.keep.caption).toContain("just stops the alerts");
  });
  it("singularizes a single pending offer", () => {
    const c = closeConfirmCopy({ tier: 1, pendingCount: 1 });
    expect(c.withdraw.caption).toContain("1 offer ");
  });
});

describe("closeResultToast", () => {
  it("info when nothing happened", () => {
    expect(closeResultToast({ closed: false, withdrawn: 0 }, 1)).toEqual({ kind: "info", text: "Tier was not open" });
  });
  it("success naming withdrawn count", () => {
    expect(closeResultToast({ closed: true, withdrawn: 2 }, 1)).toEqual({ kind: "success", text: "Closed tier 1 — withdrew 2 offers" });
  });
  it("success without count when closed but nothing withdrawn", () => {
    expect(closeResultToast({ closed: true, withdrawn: 0 }, 99)).toEqual({ kind: "success", text: "Closed ad-hoc casts" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/bookings.test.ts`  *(CI/Node — cannot run on the Deno-only dev machine; confirm by inspection that the imported helpers don't exist yet)*
Expected: FAIL — `buildOfferTierOptions is not a function` (and the other five undefined).

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/bookings.ts`:

```ts
// ── Offer-tier UI helpers (open/close actions in ShowDateDetailSheet) ──────────

export interface OfferTierOption { value: number; label: string }

/** A tier's human noun, used across toasts and dialog copy. 99 = ad-hoc convention. */
function tierNoun(tier: number): string {
  return tier === 99 ? "ad-hoc casts" : `tier ${tier}`;
}

/** Dropdown options: deduped+sorted city tiers (drop <1 and stray 99), then Ad-hoc(99). */
export function buildOfferTierOptions(
  input: { priorities: number[]; hasAdHoc: boolean },
): OfferTierOption[] {
  const uniq = Array.from(new Set(input.priorities))
    .filter((p) => Number.isFinite(p) && p >= 1 && p !== 99)
    .sort((a, b) => a - b);
  const opts: OfferTierOption[] = uniq.map((p) => ({ value: p, label: `Tier ${p}` }));
  if (input.hasAdHoc) opts.push({ value: 99, label: "Ad-hoc casts" });
  return opts;
}

/** Map an open-offer-tier result to a toast kind + text. */
export function offerResultToast(
  result: { offersCreated: number; message?: string },
  tier: number,
): { kind: "success" | "info"; text: string } {
  if (result.offersCreated > 0) {
    const n = result.offersCreated;
    return { kind: "success", text: `Opened ${tierNoun(tier)} — ${n} offer${n === 1 ? "" : "s"} created` };
  }
  return { kind: "info", text: result.message ?? "No new offers created" };
}

/** Confirmation copy for opening a tier; re-open note explains the additive semantics. */
export function offerConfirmCopy(
  input: { tier: number; dateLabel: string; alreadyOpened: boolean },
): { title: string; body: string } {
  const noun = tierNoun(input.tier);
  const base =
    `This creates suggested bookings for all eligible artists in ${noun} for ${input.dateLabel}. ` +
    `They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.`;
  const cap = input.tier === 99 ? "Ad-hoc casts have" : `Tier ${input.tier} has`;
  const reopen = input.alreadyOpened
    ? ` ${cap} already been opened — re-opening only adds offers for artists who don't have one yet.`
    : "";
  return { title: `Open ${noun} offers?`, body: base + reopen };
}

/** Count still-pending (suggested) offers for a tier — feeds the close dialog. */
export function pendingOfferCount(
  bookings: ReadonlyArray<{ status: string; offer_tier: number | null }>,
  tier: number,
): number {
  return bookings.filter((b) => b.status === "suggested" && b.offer_tier === tier).length;
}

export interface CloseConfirmCopy {
  title: string;
  intro: string;
  withdraw: { label: string; caption: string };
  keep: { label: string; caption: string };
}

/** Jargon-free copy for the close dialog's two choices. */
export function closeConfirmCopy(input: { tier: number; pendingCount: number }): CloseConfirmCopy {
  const noun = tierNoun(input.tier);
  const n = input.pendingCount;
  const s = n === 1 ? "" : "s";
  return {
    title: `Close ${noun}?`,
    intro: `Closing stops the reminder and at-risk alerts for ${noun}.`,
    withdraw: {
      label: "Withdraw unanswered offers",
      caption: n > 0
        ? `Cancels the ${n} offer${s} no-one has accepted yet, so those artists can't take a spot later. Anyone who already accepted keeps their spot.`
        : "No unanswered offers to cancel. Anyone who already accepted keeps their spot.",
    },
    keep: {
      label: "Keep offers open",
      caption: n > 0
        ? `Leaves the ${n} unanswered offer${s} live — artists can still accept until the offers expire.`
        : "Nothing to withdraw — this just stops the alerts.",
    },
  };
}

/** Map a close-offer-tier result to a toast kind + text. */
export function closeResultToast(
  result: { closed: boolean; withdrawn: number; message?: string },
  tier: number,
): { kind: "success" | "info"; text: string } {
  const noun = tierNoun(tier);
  if (!result.closed && result.withdrawn === 0) {
    return { kind: "info", text: result.message ?? "Tier was not open" };
  }
  if (result.withdrawn > 0) {
    const n = result.withdrawn;
    return { kind: "success", text: `Closed ${noun} — withdrew ${n} offer${n === 1 ? "" : "s"}` };
  }
  return { kind: "success", text: `Closed ${noun}` };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/bookings.test.ts`  *(CI-verified)*
Expected: PASS — all new describe blocks plus the existing `deriveBookingGroups` / `computeInheritedCastIds` / `bookingStatusUpdate` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings.ts src/lib/bookings.test.ts
git commit -m "feat(offers): pure helpers for offer-tier open/close UI"
```

---

## Task 4: Data-access in `src/data/bookings.ts`

**Files:**
- Create: `src/data/bookings.ts`
- Test: `src/data/bookings.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/data/bookings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier } from "./bookings";

describe("openOfferTier", () => {
  it("sends snake_case body and returns offersCreated", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 2 }, error: null } });
    const res = await openOfferTier(fake as never, { showDateId: "d1", tier: 1 });
    expect(res).toEqual({ offersCreated: 2, message: undefined });
    expect(fake.calls).toContainEqual({ table: "fn:open-offer-tier", method: "invoke", args: [{ show_date_id: "d1", tier: 1 }] });
  });
  it("passes a benign message through", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 0, message: "No casts at tier 2 for this city" }, error: null } });
    const res = await openOfferTier(fake as never, { showDateId: "d1", tier: 2 });
    expect(res).toEqual({ offersCreated: 0, message: "No casts at tier 2 for this city" });
  });
  it("throws on transport error", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: null, error: { message: "network" } } });
    await expect(openOfferTier(fake as never, { showDateId: "d1", tier: 1 })).rejects.toBeTruthy();
  });
  it("throws on a 200 body carrying { error }", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { error: "Show date is cancelled" }, error: null } });
    await expect(openOfferTier(fake as never, { showDateId: "d1", tier: 1 })).rejects.toThrow("Show date is cancelled");
  });
});

describe("fetchOfferTiers", () => {
  it("returns priorities for the city and detects ad-hoc", async () => {
    const fake = createFakeSupabase({
      cast_city_priority: { data: [{ priority: 1 }, { priority: 2 }, { priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [{ id: "x" }], error: null },
    });
    const res = await fetchOfferTiers(fake as never, { cityId: "c1", showDateId: "d1" });
    expect(res).toEqual({ priorities: [1, 2, 1], hasAdHoc: true });
  });
  it("skips the priority query when there is no city", async () => {
    const fake = createFakeSupabase({ show_date_cast_eligibility: { data: [], error: null } });
    const res = await fetchOfferTiers(fake as never, { cityId: null, showDateId: "d1" });
    expect(res).toEqual({ priorities: [], hasAdHoc: false });
    expect(fake.calls.find((c) => c.table === "cast_city_priority")).toBeUndefined();
  });
});

describe("fetchOpenedTiers", () => {
  it("maps rows to camelCase", async () => {
    const fake = createFakeSupabase({
      show_date_offer_tiers: { data: [{ tier: 1, opened_at: "2026-07-01T00:00:00Z", closed_at: null }], error: null },
    });
    const res = await fetchOpenedTiers(fake as never, "d1");
    expect(res).toEqual([{ tier: 1, openedAt: "2026-07-01T00:00:00Z", closedAt: null }]);
  });
});

describe("closeOfferTier", () => {
  it("sends body with withdraw and returns parsed result", async () => {
    const fake = createFakeSupabase({ "fn:close-offer-tier": { data: { closed: true, withdrawn: 3 }, error: null } });
    const res = await closeOfferTier(fake as never, { showDateId: "d1", tier: 2, withdraw: true });
    expect(res).toEqual({ closed: true, withdrawn: 3, message: undefined });
    expect(fake.calls).toContainEqual({ table: "fn:close-offer-tier", method: "invoke", args: [{ show_date_id: "d1", tier: 2, withdraw: true }] });
  });
  it("throws on a 200 body carrying { error }", async () => {
    const fake = createFakeSupabase({ "fn:close-offer-tier": { data: { error: "nope" }, error: null } });
    await expect(closeOfferTier(fake as never, { showDateId: "d1", tier: 1, withdraw: false })).rejects.toThrow("nope");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/bookings.test.ts`  *(CI/Node — confirm by inspection the module is absent)*
Expected: FAIL — cannot resolve `./bookings` (file doesn't exist).

- [ ] **Step 3: Implement the data-access functions**

Create `src/data/bookings.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface OpenOfferTierResult { offersCreated: number; message?: string }

/** Invoke the open-offer-tier edge function for one (show_date, tier). */
export async function openOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number },
): Promise<OpenOfferTierResult> {
  const { data, error } = await client.functions.invoke("open-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier },
  });
  if (error) throw error;
  const payload = data as { offers_created?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { offersCreated: payload?.offers_created ?? 0, message: payload?.message };
}

/** Tiers that *can* be opened for a date: city priorities (raw) + ad-hoc presence. */
export async function fetchOfferTiers(
  client: SupabaseClient<Database>,
  args: { cityId: string | null; showDateId: string },
): Promise<{ priorities: number[]; hasAdHoc: boolean }> {
  let priorities: number[] = [];
  if (args.cityId) {
    const { data, error } = await client
      .from("cast_city_priority")
      .select("priority")
      .eq("city_id", args.cityId);
    if (error) throw error;
    priorities = (data ?? []).map((r) => r.priority as number);
  }
  const { data: adHoc, error: adErr } = await client
    .from("show_date_cast_eligibility")
    .select("id")
    .eq("show_date_id", args.showDateId)
    .limit(1);
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

export interface CloseOfferTierResult { closed: boolean; withdrawn: number; message?: string }

/** Invoke the close-offer-tier edge function for one (show_date, tier). */
export async function closeOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number; withdraw: boolean },
): Promise<CloseOfferTierResult> {
  const { data, error } = await client.functions.invoke("close-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier, withdraw: args.withdraw },
  });
  if (error) throw error;
  const payload = data as { closed?: boolean; withdrawn?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { closed: !!payload?.closed, withdrawn: payload?.withdrawn ?? 0, message: payload?.message };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/bookings.test.ts`  *(CI-verified)*
Expected: PASS — all four describe blocks.

- [ ] **Step 5: Commit**

```bash
git add src/data/bookings.ts src/data/bookings.test.ts
git commit -m "feat(offers): data-access for open/close offer tier + tier reads"
```

---

## Task 5: "Offers" card in `ShowDateDetailSheet`

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx`

> No automated test (the component's other queries use the `supabase` singleton inline; mocking the client is against repo convention). Verified via `tsc`/`eslint` in CI + manual run. All branch/format logic was already unit-tested in Tasks 3–4.

- [ ] **Step 1: Update imports and add `useState`**

In `src/components/shows/ShowDateDetailSheet.tsx`:

Change line 1 from:
```ts
import { useMemo } from 'react';
```
to:
```ts
import { useMemo, useState } from 'react';
```

Add these imports after the existing `Popover` import (line 13):
```ts
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
```

Replace the `@/lib/bookings` import (line 20) with:
```ts
import {
  deriveBookingGroups, computeInheritedCastIds, bookingStatusUpdate,
  buildOfferTierOptions, offerResultToast, offerConfirmCopy,
  pendingOfferCount, closeConfirmCopy, closeResultToast,
} from '@/lib/bookings';
import { formatDateDMY } from '@/lib/dates';
import { openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier } from '@/data/bookings';
```

- [ ] **Step 2: Add queries, derived values, and local state**

Immediately after the `eligibility` query line (`const { data: eligibility } = useEligibleArtists(showId, showDateId, cityId);`, line 115), add:

```ts
  const tiersQ = useQuery({
    queryKey: ['offer-tiers', 'available', showDateId, cityId],
    enabled: canManage && !!showDateId,
    queryFn: () => fetchOfferTiers(supabase, { cityId, showDateId: showDateId! }),
  });
  const openedQ = useQuery({
    queryKey: ['offer-tiers', 'opened', showDateId],
    enabled: canManage && !!showDateId,
    queryFn: () => fetchOpenedTiers(supabase, showDateId!),
  });

  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<number | null>(null);

  const tierOptions = useMemo(
    () => buildOfferTierOptions(tiersQ.data ?? { priorities: [], hasAdHoc: false }),
    [tiersQ.data]
  );
  const effectiveTier = selectedTier ?? tierOptions[0]?.value ?? null;
  const hasSession = !!(showDate?.session_1 || showDate?.session_2 || showDate?.session_3);
  const alreadyOpened = (openedQ.data ?? []).some(o => o.tier === effectiveTier && !o.closedAt);
```

- [ ] **Step 3: Add the open/close mutations**

Immediately after the `updateBookingStatus` mutation block (ends line 211), add:

```ts
  const openOffers = useMutation({
    mutationFn: (tier: number) => openOfferTier(supabase, { showDateId: showDateId!, tier }),
    onSuccess: (res, tier) => {
      const { kind, text } = offerResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeOffers = useMutation({
    mutationFn: ({ tier, withdraw }: { tier: number; withdraw: boolean }) =>
      closeOfferTier(supabase, { showDateId: showDateId!, tier, withdraw }),
    onSuccess: (res, { tier }) => {
      const { kind, text } = closeResultToast(res, tier);
      if (kind === 'success') toast.success(text); else toast.info(text);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['offer-tiers', 'opened', showDateId] });
      setCloseTarget(null);
    },
    onError: (err: any) => { toast.error(err.message); setCloseTarget(null); },
  });
```

- [ ] **Step 4: Add the Offers card JSX**

Immediately before the `{/* Assigned Artists */}` comment (line 397), insert:

```tsx
              {/* Offers */}
              {canManage && showDate.status !== 'cancelled' && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base">Offers</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Opened tiers */}
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Opened tiers</p>
                      {(openedQ.data ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No tiers opened yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(openedQ.data ?? []).map(o => (
                            <Badge key={o.tier} variant="outline" className="flex items-center gap-2 py-1">
                              <span>
                                {o.tier === 99 ? 'Ad-hoc casts' : `Tier ${o.tier}`}
                                <span className="ml-1 opacity-60">
                                  {o.closedAt
                                    ? `· closed ${formatDateDMY(o.closedAt)}`
                                    : `· opened ${formatDateDMY(o.openedAt)}`}
                                </span>
                              </span>
                              {!o.closedAt && (
                                <button
                                  type="button"
                                  onClick={() => setCloseTarget(o.tier)}
                                  className="text-destructive hover:underline text-xs"
                                >
                                  Close
                                </button>
                              )}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Open a tier */}
                    {tierOptions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No offer tiers configured for this city — set cast priorities in Settings → Cities &amp; Casts.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={effectiveTier != null ? String(effectiveTier) : undefined}
                          onValueChange={v => setSelectedTier(Number(v))}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Select tier" />
                          </SelectTrigger>
                          <SelectContent>
                            {tierOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button disabled={!hasSession || openOffers.isPending || effectiveTier == null}>
                              {openOffers.isPending
                                ? 'Opening…'
                                : `Open ${effectiveTier === 99 ? 'ad-hoc casts' : `tier ${effectiveTier}`}`}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            {effectiveTier != null && (
                              <>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {offerConfirmCopy({ tier: effectiveTier, dateLabel: formatDateDMY(showDate.date), alreadyOpened }).title}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {offerConfirmCopy({ tier: effectiveTier, dateLabel: formatDateDMY(showDate.date), alreadyOpened }).body}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => openOffers.mutate(effectiveTier)}>
                                    Open offers
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </>
                            )}
                          </AlertDialogContent>
                        </AlertDialog>

                        {!hasSession && (
                          <span className="text-xs text-muted-foreground">
                            Add a session time before opening offers.
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Close-tier confirmation (choose withdraw vs keep) */}
              <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
                <AlertDialogContent>
                  {closeTarget !== null && (() => {
                    const copy = closeConfirmCopy({
                      tier: closeTarget,
                      pendingCount: pendingOfferCount(bookingsForDate ?? [], closeTarget),
                    });
                    return (
                      <>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                          <AlertDialogDescription>{copy.intro}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-2">
                          <button
                            type="button"
                            disabled={closeOffers.isPending}
                            onClick={() => closeOffers.mutate({ tier: closeTarget, withdraw: true })}
                            className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                          >
                            <p className="text-sm font-medium">{copy.withdraw.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{copy.withdraw.caption}</p>
                          </button>
                          <button
                            type="button"
                            disabled={closeOffers.isPending}
                            onClick={() => closeOffers.mutate({ tier: closeTarget, withdraw: false })}
                            className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                          >
                            <p className="text-sm font-medium">{copy.keep.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{copy.keep.caption}</p>
                          </button>
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                        </AlertDialogFooter>
                      </>
                    );
                  })()}
                </AlertDialogContent>
              </AlertDialog>
```

- [ ] **Step 5: Verify build/lint and manual behavior**

Run (CI-verified; cannot run on the Deno-only dev machine): `npm run lint && npm run build`
Expected: no type/lint errors in `ShowDateDetailSheet.tsx`, `src/data/bookings.ts`, `src/lib/bookings.ts`.

Manual checklist (run the app, open a date detail sheet as admin/producer):
- Offers card shows above Assigned Artists; "No tiers opened yet." initially.
- Tier dropdown lists configured tiers (+ "Ad-hoc casts" when per-date casts exist).
- With no session time, the Open button is disabled and the helper text shows.
- Open → confirm dialog → on confirm, a success/info toast appears and suggested artists show under Assigned Artists; an "opened" badge appears.
- Each open tier badge has a "Close" button → dialog offers "Withdraw unanswered offers" / "Keep offers open" with the live pending count; choosing one toasts and updates the badge to "closed".
- A cancelled date shows no Offers card.

- [ ] **Step 6: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx
git commit -m "feat(offers): Offers card with open/close tier actions in date sheet"
```

---

## Final verification

- [ ] **Run the full edge-function suite locally**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS (Tasks 1–2 covered locally).

- [ ] **Confirm CI is green** for the vitest suites (`src/lib/bookings.test.ts`, `src/data/bookings.test.ts`) and `lint`/`build` (Tasks 3–5), which cannot run on the Deno-only dev machine.

- [ ] **Integrate the branch** using the superpowers:finishing-a-development-branch skill (PR to `main`).
