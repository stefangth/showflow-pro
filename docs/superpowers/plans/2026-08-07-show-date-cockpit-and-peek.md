# Show Date Cockpit + Row Peek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay-out `ShowDateDetailSheet` into a cockpit (anchored header · facts/activity rail · tabbed work surface) and add a hover/keyboard "peek" popover to bookings-list rows, reusing every existing flow-aware component and reflecting (not toggling) the org booking flow.

**Architecture:** No new data model and no new backend. The cockpit re-composes existing tested components (`TierTimeline`, `EligibilityBookList`, `AssignedArtistsCard`, `HireOrdersCard`, `ChatPanel`, `RequiredSkillsSection`, `BookingFunnel`, `UpNextStrip`) into a header/rail/tab shell; new code is pure glue helpers in `src/lib/bookingCockpit.ts`, two extracted presentational components, and one peek component. The peek reads a per-status extension of the existing `['bookings','counts-by-date']` query and confirms via the existing `bulkConfirmSoftBooked`.

**Tech Stack:** React 18 + TS, Tailwind + shadcn/Radix, `@tanstack/react-query` v5, Vitest + jsdom + Testing Library, `sonner` toasts. Supabase reads/writes go through `src/data/*` functions tested with `src/test/supabaseFake.ts`.

**Design doc:** `docs/superpowers/specs/2026-08-07-show-date-cockpit-and-peek-design.md`

## Global Constraints

- **Semantic tokens only.** `bg-surface`/`text-muted-foreground`/`border-border`/`bg-accent-500`/`rounded-l`/`shadow-elev3` etc. Never hardcode hex. `var(--font-*)` from the prototype → Tailwind `font-sans`/`font-mono`/`font-display`.
- **Accent-opacity caveat:** `bg-accent-500/20` silently drops alpha (hex vars). Use a solid stop, `rgba()` literal, or a dedicated token.
- **Week starts Monday** anywhere a grid is rendered (not applicable here but do not regress).
- **`any` is banned** (CI `--max-warnings 0`). Joined rows: explicit local `interface` + single `as unknown as Row[]` at the query boundary; test stubs via `src/test/castHelpers.ts`. Never per-site `as any`.
- **Query-key discipline:** any mutation touching `bookings` invalidates the whole `['bookings']` domain (prefix match) — never individual sub-keys.
- **Test-first.** Every task writes the failing test before implementation. Tests import the real module — never re-implement production logic in a test.
- **No em/en dashes in user-facing copy.** Use period/comma/colon/middot.
- **Do not change** `ShowDateDetailSheet`'s public props `{ showDateId, open, onOpenChange }` — three call sites depend on them (`ShowsBookingsPage.tsx:595`, `ArtistBookingsView.tsx`, `ChatsListPage.tsx`).
- **Preserve gate wiring verbatim:** `canManage`, `useCan('manage_show_dates'|'hard_delete_show_dates'|'run_offer_engine'|'confirm_bookings'|'generate_hire_orders')`, `useFeature('hire_orders')`, `useModuleGate('booking_flow')`, and the existing `showGenerateHireOrderCta` header button.
- **Full gates before "done":** `npm run lint`, `npx vitest run --coverage`, `npx tsc -p tsconfig.app.json --noEmit`.

---

## Milestone 1 — The Row Peek

### Task 1: Per-status buckets on `fetchBookingCountsByDate`

**Files:**
- Modify: `src/data/bookings.ts:378-404`
- Test: `src/data/bookings.countsByDate.test.ts` (create)

**Interfaces:**
- Produces: `DateBookingCounts = { confirmedMain, confirmedUs, acceptedMain, acceptedUs, pendingMain, pendingUs, total }` (all `number`). `fetchBookingCountsByDate(client, orgId): Promise<Map<string, DateBookingCounts>>` (unchanged signature).
- Consumes: nothing.

Note: existing consumers read only `confirmedMain`/`confirmedUs`/`total` — those keep their meaning (`total` = all non-cancelled). New fields are additive; `_computed.slots` cell at `ShowsBookingsPage.tsx:492` keeps working unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/bookings.countsByDate.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchBookingCountsByDate } from "./bookings";

describe("fetchBookingCountsByDate per-status buckets", () => {
  it("buckets confirmed/accepted(soft_booked)/pending(suggested) by main vs understudy, ignores cancelled", async () => {
    const client = createFakeSupabase({
      bookings: { data: [
        { show_date_id: "d1", status: "confirmed",   is_understudy: false },
        { show_date_id: "d1", status: "confirmed",   is_understudy: true  },
        { show_date_id: "d1", status: "soft_booked", is_understudy: false },
        { show_date_id: "d1", status: "suggested",   is_understudy: false },
        { show_date_id: "d1", status: "cancelled",   is_understudy: false },
      ], error: null },
    });
    const map = await fetchBookingCountsByDate(asSupabase(client), "org-1");
    expect(map.get("d1")).toEqual({
      confirmedMain: 1, confirmedUs: 1,
      acceptedMain: 1, acceptedUs: 0,
      pendingMain: 1, pendingUs: 0,
      total: 4, // non-cancelled only
    });
  });

  it("returns an empty map for a null org", async () => {
    const client = createFakeSupabase({});
    expect((await fetchBookingCountsByDate(asSupabase(client), null)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/bookings.countsByDate.test.ts`
Expected: FAIL — `acceptedMain`/`pendingMain` undefined (object shape mismatch).

- [ ] **Step 3: Implement the extension**

Replace `DateBookingCounts` and the loop body in `src/data/bookings.ts:378-404`:

```ts
export interface DateBookingCounts {
  confirmedMain: number; confirmedUs: number;
  acceptedMain: number; acceptedUs: number;   // soft_booked, waiting on producer confirm
  pendingMain: number; pendingUs: number;      // suggested, awaiting artist response
  total: number;                                // all non-cancelled
}

/** Per-show-date booking tallies for the bookings grid + row peek (non-cancelled only). */
export async function fetchBookingCountsByDate(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Map<string, DateBookingCounts>> {
  const map = new Map<string, DateBookingCounts>();
  if (!orgId) return map;
  const { data, error } = await client
    .from("bookings")
    .select("show_date_id, status, is_understudy")
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  if (error) throw error;
  interface CountRow { show_date_id: string; status: string; is_understudy: boolean }
  const zero = (): DateBookingCounts => ({
    confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 0,
  });
  for (const b of (data ?? []) as unknown as CountRow[]) {
    const cur = map.get(b.show_date_id) ?? zero();
    cur.total += 1;
    const us = b.is_understudy;
    if (b.status === "confirmed") { us ? cur.confirmedUs++ : cur.confirmedMain++; }
    else if (b.status === "soft_booked") { us ? cur.acceptedUs++ : cur.acceptedMain++; }
    else if (b.status === "suggested") { us ? cur.pendingUs++ : cur.pendingMain++; }
    map.set(b.show_date_id, cur);
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/bookings.countsByDate.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/data/bookings.ts src/data/bookings.countsByDate.test.ts
git commit -m "extend booking counts-by-date with accepted/pending buckets"
```

---

### Task 2: `computeDatePeek` pure helper

**Files:**
- Modify: `src/lib/bookingCockpit.ts` (append)
- Test: `src/lib/bookingCockpit.datePeek.test.ts` (create)

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  ```ts
  export interface DatePeekSeg { tone: "confirmed" | "accepted" | "open" }
  export interface DatePeek {
    tone: "filled" | "at-risk" | "neutral";
    eyebrowSuffix: "filled" | "at risk" | "open";
    headline: string;
    meter: DatePeekSeg[];
    acceptedWaiting: number;
    openSlots: number;
    confirmable: boolean;
  }
  export function computeDatePeek(args: {
    counts: Pick<DateBookingCounts, "confirmedMain"|"confirmedUs"|"acceptedMain"|"acceptedUs"> | null;
    slots: { main_cast: number; understudies: number } | null;
  }): DatePeek | null   // null when slots unconfigured
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bookingCockpit.datePeek.test.ts
import { describe, it, expect } from "vitest";
import { computeDatePeek } from "./bookingCockpit";

const C = (o: Partial<Record<"confirmedMain"|"confirmedUs"|"acceptedMain"|"acceptedUs", number>>) =>
  ({ confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, ...o });

describe("computeDatePeek", () => {
  it("returns null when slots are unconfigured", () => {
    expect(computeDatePeek({ counts: C({}), slots: null })).toBeNull();
  });

  it("2 confirmed + 2 accepted + 2 open -> at-risk, meter tones, headline", () => {
    const p = computeDatePeek({
      counts: C({ confirmedMain: 2, acceptedMain: 2 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.tone).toBe("at-risk");
    expect(p.eyebrowSuffix).toBe("at risk");
    expect(p.acceptedWaiting).toBe(2);
    expect(p.openSlots).toBe(2);
    expect(p.confirmable).toBe(true);
    expect(p.headline).toBe("2 accepted waiting on you · 2 main slots open");
    expect(p.meter.map(s => s.tone)).toEqual([
      "confirmed","confirmed","accepted","accepted","open","open",
    ]);
  });

  it("all confirmed -> filled tone and headline, not confirmable", () => {
    const p = computeDatePeek({
      counts: C({ confirmedMain: 4, confirmedUs: 2 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.tone).toBe("filled");
    expect(p.eyebrowSuffix).toBe("filled");
    expect(p.headline).toBe("All 6 slots confirmed");
    expect(p.confirmable).toBe(false);
    expect(p.meter.every(s => s.tone === "confirmed")).toBe(true);
  });

  it("only understudy open -> reports understudy slots open", () => {
    const p = computeDatePeek({
      counts: C({ confirmedMain: 4 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.headline).toBe("2 understudy slots open");
    expect(p.tone).toBe("at-risk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookingCockpit.datePeek.test.ts`
Expected: FAIL — `computeDatePeek is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/bookingCockpit.ts`:

```ts
export interface DatePeekSeg { tone: "confirmed" | "accepted" | "open" }
export interface DatePeek {
  tone: "filled" | "at-risk" | "neutral";
  eyebrowSuffix: "filled" | "at risk" | "open";
  headline: string;
  meter: DatePeekSeg[];
  acceptedWaiting: number;
  openSlots: number;
  confirmable: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Compact summary for the bookings-row peek. Null when the date has no slot config. */
export function computeDatePeek(args: {
  counts: { confirmedMain: number; confirmedUs: number; acceptedMain: number; acceptedUs: number } | null;
  slots: { main_cast: number; understudies: number } | null;
}): DatePeek | null {
  const { slots } = args;
  if (!slots) return null;
  const c = args.counts ?? { confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0 };
  const total = slots.main_cast + slots.understudies;
  const confirmed = Math.min(total, c.confirmedMain + c.confirmedUs);
  const accepted = Math.min(total - confirmed, c.acceptedMain + c.acceptedUs);
  const openSlots = Math.max(0, total - confirmed - accepted);
  const openMain = Math.max(0, slots.main_cast - c.confirmedMain - c.acceptedMain);
  const openUs = Math.max(0, slots.understudies - c.confirmedUs - c.acceptedUs);

  const meter: DatePeekSeg[] = Array.from({ length: total }, (_, i) =>
    ({ tone: i < confirmed ? "confirmed" : i < confirmed + accepted ? "accepted" : "open" }));

  let tone: DatePeek["tone"]; let eyebrowSuffix: DatePeek["eyebrowSuffix"];
  if (confirmed >= total) { tone = "filled"; eyebrowSuffix = "filled"; }
  else if (openSlots > 0) { tone = "at-risk"; eyebrowSuffix = "at risk"; }
  else { tone = "neutral"; eyebrowSuffix = "open"; }

  let headline: string;
  if (confirmed >= total) {
    headline = `All ${total} slots confirmed`;
  } else {
    const parts: string[] = [];
    if (accepted > 0) parts.push(`${plural(accepted, "accepted waiting on you", "accepted waiting on you")}`);
    if (openMain > 0) parts.push(`${plural(openMain, "main slot open", "main slots open")}`);
    else if (openUs > 0) parts.push(`${plural(openUs, "understudy slot open", "understudy slots open")}`);
    headline = parts.length ? parts.join(" · ") : "Ready to confirm";
  }

  return { tone, eyebrowSuffix, headline, meter, acceptedWaiting: accepted, openSlots, confirmable: accepted > 0 };
}
```

> `plural(accepted, "accepted waiting on you", "accepted waiting on you")` is intentional: the phrase does not inflect ("2 accepted waiting on you"). Keeping the helper call makes the count prefix explicit and uniform with the slot phrases.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/bookingCockpit.datePeek.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingCockpit.ts src/lib/bookingCockpit.datePeek.test.ts
git commit -m "add computeDatePeek helper for the bookings row peek"
```

---

### Task 3: `RowPeek` presentational component

**Files:**
- Create: `src/components/bookings/RowPeek.tsx`
- Test: `src/components/bookings/RowPeek.test.tsx`

**Interfaces:**
- Consumes: `DatePeek` (Task 2).
- Produces:
  ```ts
  export interface RowPeekProps {
    dateLabel: string;                 // e.g. "Thu 12 Mar"
    peek: DatePeek | null;             // null -> unconfigured minimal view
    canConfirm: boolean;
    confirming: boolean;
    onConfirm: () => void;
    onOpen: () => void;
  }
  export function RowPeek(props: RowPeekProps): JSX.Element
  ```

This is the popover *content* only (a plain card); anchoring/open-state is Task 4. Faithful to the 1d markup: eyebrow, headline, meter, Confirm/Open buttons, "Space to peek · Enter to open" hint.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/bookings/RowPeek.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowPeek } from "./RowPeek";
import type { DatePeek } from "@/lib/bookingCockpit";

const atRisk: DatePeek = {
  tone: "at-risk", eyebrowSuffix: "at risk",
  headline: "2 accepted waiting on you · 2 main slots open",
  meter: [{tone:"confirmed"},{tone:"confirmed"},{tone:"accepted"},{tone:"accepted"},{tone:"open"},{tone:"open"}],
  acceptedWaiting: 2, openSlots: 2, confirmable: true,
};

describe("RowPeek", () => {
  it("renders eyebrow, headline, and a Confirm N + Open date action", () => {
    const onConfirm = vi.fn(); const onOpen = vi.fn();
    render(<RowPeek dateLabel="Thu 12 Mar" peek={atRisk} canConfirm confirming={false} onConfirm={onConfirm} onOpen={onOpen} />);
    expect(screen.getByText(/Thu 12 Mar · at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/2 accepted waiting on you/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm 2/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /open date/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("hides Confirm when not confirmable, shows only Open date", () => {
    const filled: DatePeek = { ...atRisk, tone: "filled", eyebrowSuffix: "filled", confirmable: false, acceptedWaiting: 0, headline: "All 6 slots confirmed" };
    render(<RowPeek dateLabel="Wed 11 Mar" peek={filled} canConfirm confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open date/i })).toBeInTheDocument();
  });

  it("hides Confirm when the user lacks the capability", () => {
    render(<RowPeek dateLabel="Thu 12 Mar" peek={atRisk} canConfirm={false} confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("unconfigured (peek null): shows a minimal Open date, no meter", () => {
    render(<RowPeek dateLabel="Thu 12 Mar" peek={null} canConfirm confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/unconfigured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open date/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/bookings/RowPeek.test.tsx`
Expected: FAIL — cannot find `./RowPeek`.

- [ ] **Step 3: Implement**

```tsx
// src/components/bookings/RowPeek.tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DatePeek, DatePeekSeg } from "@/lib/bookingCockpit";

const SEG_BG: Record<DatePeekSeg["tone"], string> = {
  confirmed: "bg-[var(--green-500)]",
  accepted: "bg-accent-400",
  open: "bg-[var(--surface-3)]",
};

const EYEBROW_TONE: Record<DatePeek["tone"], string> = {
  filled: "text-[var(--green-600)]",
  "at-risk": "text-[var(--amber-600)]",
  neutral: "text-accent-600",
};

export interface RowPeekProps {
  dateLabel: string;
  peek: DatePeek | null;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onOpen: () => void;
}

export function RowPeek({ dateLabel, peek, canConfirm, confirming, onConfirm, onOpen }: RowPeekProps) {
  return (
    <div className="w-80 p-3.5">
      <p className={cn("text-[11px] font-semibold uppercase tracking-[0.13em]", peek ? EYEBROW_TONE[peek.tone] : "text-muted-foreground")}>
        {dateLabel}{peek ? ` · ${peek.eyebrowSuffix}` : " · unconfigured"}
      </p>
      {peek ? (
        <>
          <p className="mt-1.5 text-sm font-medium">{peek.headline}</p>
          <div className="mt-2.5 flex gap-[3px]">
            {peek.meter.map((s, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-[2px]", SEG_BG[s.tone])} />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">Set cast slots in Settings to track fill.</p>
      )}
      <div className="mt-3.5 flex gap-2">
        {peek?.confirmable && canConfirm && (
          <Button size="sm" className="flex-1" disabled={confirming} onClick={onConfirm}>
            {confirming ? "Confirming…" : `Confirm ${peek.acceptedWaiting}`}
          </Button>
        )}
        <Button size="sm" variant="outline" className="flex-1" onClick={onOpen}>Open date</Button>
      </div>
      <p className="mt-2.5 font-mono text-[11px] text-[var(--text-faint)]">Space to peek · Enter to open</p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/bookings/RowPeek.test.tsx`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/components/bookings/RowPeek.tsx src/components/bookings/RowPeek.test.tsx
git commit -m "add RowPeek popover content for bookings rows"
```

---

### Task 4: Wire the peek into `ShowsBookingsPage`

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx` (imports; `openShowDateOnKey` at 149-154; the list `TableRow` at 522-532; add peek state + a single controlled `Popover`)
- Test: `src/pages/ShowsBookingsPage.peek.test.tsx` (create)

**Interfaces:**
- Consumes: `RowPeek` (Task 3), `computeDatePeek` (Task 2), `fetchBookingCountsByDate` buckets (Task 1), `bulkConfirmSoftBooked` (`src/data/bookings.ts:193`), `fetchBookingsForDate`/equivalent for `soft_booked` ids (see Step 3).
- Produces: nothing downstream.

**Design of the interaction** (single page-level controlled peek, anchored to the active row — columns are admin-configurable so anchor to the *row*, not a cell):
- `peekId: string | null` + a `peekAnchor` ref to the active `<tr>`.
- Row `onMouseEnter` starts a 250ms timer → `setPeekId(sd.id)`; `onMouseLeave` clears the timer and, if focus is not inside the popover, `setPeekId(null)`.
- Keyboard: `Enter` opens the full sheet (`openShowDate`), `Space` opens the peek (`setPeekId`), `Escape` closes the peek. (Today both Enter and Space open the sheet — this splits them, matching the "Space to peek · Enter to open" hint.)
- The peek's Confirm lazily fetches the date's `soft_booked` booking ids, calls `bulkConfirmSoftBooked`, then invalidates `['bookings']`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/ShowsBookingsPage.peek.test.tsx
// Focused test of the peek behaviours only. Render the page with providers,
// seed one at-risk date + counts, open the peek via Space, assert content and
// that Confirm calls bulkConfirmSoftBooked with the date's soft_booked ids.
//
// Follow the existing ShowsBookingsPage test harness conventions in the repo
// (renderWithProviders + supabaseFake). If ShowsBookingsPage has no existing
// test file to copy the mock scaffold from, mock: useAuth (producer, currentOrg),
// useCan -> true, useFeature -> booking_flow true / hire_orders false,
// useColumnTemplate -> default columns, and the filter-visibility hook -> allow.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

// ... mock scaffold per the note above ...

describe("ShowsBookingsPage row peek", () => {
  it("Space opens the peek; Enter opens the full sheet", async () => {
    // seed one show_date sd-1 (Nutcracker, main 4 / us 2) + counts {confirmedMain:2, acceptedMain:2}
    // render; find the sd-1 row; fireEvent.keyDown(row, { key: ' ' });
    // expect the peek headline "2 accepted waiting on you · 2 main slots open" to appear.
    // fireEvent.keyDown(row, { key: 'Enter' }); expect the ShowDateDetailSheet dialog to open.
  });

  it("Confirm N bulk-confirms the date's soft_booked bookings", async () => {
    // open peek via Space; click "Confirm 2";
    // expect a bookings .update({status:'confirmed'}) call scoped to the date's soft_booked ids
    //   (assert via the fake client's recorded calls), and a success toast.
  });
});
```

> The two test bodies above are stubs describing exact assertions; fill them using the repo's existing page-test scaffold (search for another `pages/*.test.tsx` using `renderWithProviders`). If page-level rendering proves too heavy, extract the peek trigger+state into a small `useRowPeek(sd)` hook or a `<BookingsRow>` component and unit-test that instead — either satisfies the behaviour contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/ShowsBookingsPage.peek.test.tsx`
Expected: FAIL — peek not wired.

- [ ] **Step 3: Implement — keyboard split**

Replace `openShowDateOnKey` (`ShowsBookingsPage.tsx:149-154`):

```tsx
const [peekId, setPeekId] = useState<string | null>(null);
const openShowDateOnKey = (id: string) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') { e.preventDefault(); setPeekId(null); openShowDate(id); }
  else if (e.key === ' ') { e.preventDefault(); setPeekId(id); }
  else if (e.key === 'Escape') { setPeekId(null); }
};
```

- [ ] **Step 4: Implement — row hover + anchored peek**

On the list `TableRow` (`ShowsBookingsPage.tsx:522-532`), add hover intent and an anchor ref, and render a single controlled `Popover` (Radix, from `@/components/ui/popover`) whose `PopoverAnchor` tracks the active row. Confirm handler:

```tsx
const qc = useQueryClient();
const [confirming, setConfirming] = useState(false);
async function confirmPeek(showDateId: string) {
  setConfirming(true);
  try {
    // lazily read this date's soft_booked ids
    const { data } = await supabase.from('bookings')
      .select('id').eq('show_date_id', showDateId).eq('status', 'soft_booked');
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      const { affected } = await bulkConfirmSoftBooked(supabase, { ids, now: new Date() });
      toast.success(affected ? `Confirmed ${affected}` : 'Nothing to confirm — it moved on');
      qc.invalidateQueries({ queryKey: ['bookings'] });
    }
  } catch (e) { toast.error((e as Error).message); }
  finally { setConfirming(false); setPeekId(null); }
}
```

Peek render (once, after the table). Use `computeDatePeek({ counts: bookingCounts.get(id), slots: showSlots(row.show) })` and a `formatDateWithWeekday`-derived short label. Anchor to the active `<tr>` via a `ref` map or a `PopoverAnchor` positioned to the hovered row; interactive children call `stopPropagation()` so they never trigger the row's `onClick`. Follow the existing per-row "Generate hire order" stopPropagation pattern.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/pages/ShowsBookingsPage.peek.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS + clean types.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ShowsBookingsPage.tsx src/pages/ShowsBookingsPage.peek.test.tsx
git commit -m "add hover/keyboard row peek to the bookings list"
```

---

## Milestone 2 — The Cockpit

### Task 5: `computeHeaderCta` pure helper

**Files:**
- Modify: `src/lib/bookingCockpit.ts` (append)
- Test: `src/lib/bookingCockpit.headerCta.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type HeaderCtaKind = "confirm" | "openTier" | "reviewOffers" | "book" | "none";
  export interface HeaderCta { kind: HeaderCtaKind; label: string }
  export function computeHeaderCta(args: {
    artistAcceptance: boolean;
    acceptedCount: number;
    confirmedCount: number;
    totalSlots: number | null;
    openTier: number | null;   // highest opened tier number, or null
    maxTier: number;           // ladder length, e.g. 3
  }): HeaderCta
  ```
  This models the *booking workflow* action only. The hire-order terminal stays the existing `showGenerateHireOrderCta` header button (Task 7), so this returns `{ kind: "none" }` when the workflow is complete.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bookingCockpit.headerCta.test.ts
import { describe, it, expect } from "vitest";
import { computeHeaderCta } from "./bookingCockpit";

describe("computeHeaderCta", () => {
  const base = { artistAcceptance: true, acceptedCount: 0, confirmedCount: 0, totalSlots: 6, openTier: 1, maxTier: 3 };

  it("accepted waiting -> Confirm N", () =>
    expect(computeHeaderCta({ ...base, acceptedCount: 2 })).toEqual({ kind: "confirm", label: "Confirm 2 accepted" }));

  it("classic, room to escalate -> Open next tier", () =>
    expect(computeHeaderCta({ ...base, openTier: 1 })).toEqual({ kind: "openTier", label: "Open tier 2" }));

  it("classic, top tier open -> Review open offers", () =>
    expect(computeHeaderCta({ ...base, openTier: 3 })).toEqual({ kind: "reviewOffers", label: "Review open offers" }));

  it("direct mode, slots to fill -> Book from eligibility", () =>
    expect(computeHeaderCta({ ...base, artistAcceptance: false })).toEqual({ kind: "book", label: "Book from eligibility" }));

  it("all confirmed -> none", () =>
    expect(computeHeaderCta({ ...base, confirmedCount: 6 })).toEqual({ kind: "none", label: "" }));

  it("unconfigured slots -> none", () =>
    expect(computeHeaderCta({ ...base, totalSlots: null })).toEqual({ kind: "none", label: "" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookingCockpit.headerCta.test.ts` → FAIL (not a function).

- [ ] **Step 3: Implement**

```ts
export type HeaderCtaKind = "confirm" | "openTier" | "reviewOffers" | "book" | "none";
export interface HeaderCta { kind: HeaderCtaKind; label: string }

/** The primary booking-workflow action for the cockpit header. The hire-order
 *  terminal is a separate, feature-gated button, so this returns "none" once the
 *  workflow itself is done. */
export function computeHeaderCta(args: {
  artistAcceptance: boolean; acceptedCount: number; confirmedCount: number;
  totalSlots: number | null; openTier: number | null; maxTier: number;
}): HeaderCta {
  const none: HeaderCta = { kind: "none", label: "" };
  if (args.acceptedCount > 0) return { kind: "confirm", label: `Confirm ${args.acceptedCount} accepted` };
  if (args.totalSlots == null || args.confirmedCount >= args.totalSlots) return none;
  if (!args.artistAcceptance) return { kind: "book", label: "Book from eligibility" };
  if (args.openTier != null && args.openTier < args.maxTier)
    return { kind: "openTier", label: `Open tier ${args.openTier + 1}` };
  return { kind: "reviewOffers", label: "Review open offers" };
}
```

- [ ] **Step 4: Run tests** → PASS (all six).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingCockpit.ts src/lib/bookingCockpit.headerCta.test.ts
git commit -m "add computeHeaderCta workflow-action helper"
```

---

### Task 6: `buildActivity` pure helper

**Files:**
- Modify: `src/lib/bookingCockpit.ts` (append)
- Test: `src/lib/bookingCockpit.activity.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface ActivityItem { iso: string; text: string }
  export function buildActivity(args: {
    bookings: Array<{ status: string; confirmed_at: string | null; artist: { name: string } | null }>;
    openedTiers: Array<{ tier: number; openedAt: string | null; closedAt: string | null }>;
    limit?: number;
  }): ActivityItem[]
  ```
  Returns real, derived events (no new backend), newest-first, capped at `limit ?? 6`. The `iso` is formatted by `CockpitRail` (Task 8), keeping this pure and locale-free.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bookingCockpit.activity.test.ts
import { describe, it, expect } from "vitest";
import { buildActivity } from "./bookingCockpit";

describe("buildActivity", () => {
  it("derives confirmed-booking and tier open/close events, newest first, capped", () => {
    const items = buildActivity({
      bookings: [
        { status: "confirmed", confirmed_at: "2026-03-09T09:00:00Z", artist: { name: "Marek Kowalczyk" } },
        { status: "soft_booked", confirmed_at: null, artist: { name: "Lena Vogt" } }, // no event
      ],
      openedTiers: [
        { tier: 2, openedAt: "2026-03-10T08:12:00Z", closedAt: null },
        { tier: 1, openedAt: "2026-03-08T08:00:00Z", closedAt: "2026-03-09T08:00:00Z" },
      ],
      limit: 6,
    });
    expect(items[0]).toEqual({ iso: "2026-03-10T08:12:00Z", text: "Tier 2 opened" });
    expect(items.map(i => i.text)).toContain("Marek Kowalczyk confirmed");
    expect(items.map(i => i.text)).toContain("Tier 1 closed");
    expect(items.map(i => i.text)).toContain("Tier 1 opened");
    expect(items.length).toBeLessThanOrEqual(6);
    // strictly descending by iso
    const isos = items.map(i => i.iso);
    expect([...isos].sort((a,b)=>b.localeCompare(a))).toEqual(isos);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
export interface ActivityItem { iso: string; text: string }

export function buildActivity(args: {
  bookings: Array<{ status: string; confirmed_at: string | null; artist: { name: string } | null }>;
  openedTiers: Array<{ tier: number; openedAt: string | null; closedAt: string | null }>;
  limit?: number;
}): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const b of args.bookings) {
    if (b.status === "confirmed" && b.confirmed_at) {
      out.push({ iso: b.confirmed_at, text: `${b.artist?.name ?? "Artist"} confirmed` });
    }
  }
  for (const t of args.openedTiers) {
    if (t.openedAt) out.push({ iso: t.openedAt, text: `Tier ${t.tier} opened` });
    if (t.closedAt) out.push({ iso: t.closedAt, text: `Tier ${t.tier} closed` });
  }
  out.sort((a, b) => b.iso.localeCompare(a.iso));
  return out.slice(0, args.limit ?? 6);
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingCockpit.ts src/lib/bookingCockpit.activity.test.ts
git commit -m "add buildActivity helper deriving date activity from real data"
```

---

### Task 7: Extract `CockpitHeader`

**Files:**
- Create: `src/components/shows/date/CockpitHeader.tsx`
- Test: `src/components/shows/date/CockpitHeader.test.tsx`

**Interfaces:**
- Consumes: `computeHeaderCta` (Task 5), `computeFunnel` (existing).
- Produces:
  ```ts
  export type CockpitTab = "cast" | "offers" | "order" | "chat" | "setup";
  export interface CockpitTabDef { id: CockpitTab; label: string; badge?: string; hidden?: boolean }
  export interface CockpitHeaderProps {
    title: string;               // referenceLabel(...) result
    dateLine: string;            // "Thursday, 12 March 2026"
    metaLine: string;            // "14:00 / 19:30 · Volksbühne, Berlin"
    slots: { main_cast: number; understudies: number } | null;
    confirmedCount: number; acceptedCount: number;
    statusText: string; statusTone: "green" | "amber" | "muted";
    workflowCta: { kind: string; label: string } | null;  // null => hidden
    workflowCtaDisabled?: boolean;
    onWorkflowCta: () => void;
    showGenerateHireOrder: boolean;
    generateDisabled: boolean; generateTitle?: string;
    onGenerate: () => void;
    flowLabel: string;           // "Classic offers" | "Direct booking"
    onEditFlow?: () => void;     // present only when canEditBookingSettings
    tabs: CockpitTabDef[];
    activeTab: CockpitTab;
    onTab: (t: CockpitTab) => void;
    devBadge?: boolean;          // isEditorMode && isRealAdmin
  }
  ```

The header renders: title + optional dev badge; date/meta lines; a slot meter (`main_cast + understudies` segments, confirmed→green / accepted→accent-400 / open→surface-3) + status dot/text; the workflow CTA button (when non-null) and, independently, the existing "Generate hire order" button (when `showGenerateHireOrder`); the read-only flow label (a button linking to Settings when `onEditFlow` present, else plain text); and the tab bar (skipping `hidden` tabs, active tab underlined).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shows/date/CockpitHeader.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CockpitHeader, type CockpitHeaderProps } from "./CockpitHeader";

const base: CockpitHeaderProps = {
  title: "Nutcracker · Tour B", dateLine: "Thursday, 12 March 2026",
  metaLine: "14:00 / 19:30 · Volksbühne, Berlin",
  slots: { main_cast: 4, understudies: 2 }, confirmedCount: 2, acceptedCount: 2,
  statusText: "Tier 2 open", statusTone: "amber",
  workflowCta: { kind: "confirm", label: "Confirm 2 accepted" }, onWorkflowCta: vi.fn(),
  showGenerateHireOrder: false, generateDisabled: false, onGenerate: vi.fn(),
  flowLabel: "Classic offers",
  tabs: [
    { id: "cast", label: "Cast" }, { id: "offers", label: "Offers" },
    { id: "order", label: "Hire order", hidden: true }, { id: "chat", label: "Chat" },
    { id: "setup", label: "Setup" },
  ],
  activeTab: "cast", onTab: vi.fn(),
};

describe("CockpitHeader", () => {
  it("renders the workflow CTA and fires it", () => {
    const onWorkflowCta = vi.fn();
    render(<CockpitHeader {...base} onWorkflowCta={onWorkflowCta} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm 2 accepted/i }));
    expect(onWorkflowCta).toHaveBeenCalledOnce();
  });

  it("hides tabs marked hidden (hire order off)", () => {
    render(<CockpitHeader {...base} />);
    expect(screen.queryByRole("button", { name: /hire order/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cast$/i })).toBeInTheDocument();
  });

  it("shows the Generate hire order button only when enabled by the flag", () => {
    const { rerender } = render(<CockpitHeader {...base} showGenerateHireOrder={false} />);
    expect(screen.queryByRole("button", { name: /generate hire order/i })).not.toBeInTheDocument();
    rerender(<CockpitHeader {...base} showGenerateHireOrder onGenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /generate hire order/i })).toBeInTheDocument();
  });

  it("renders flow label as a Settings link only when onEditFlow is provided", () => {
    const onEditFlow = vi.fn();
    const { rerender } = render(<CockpitHeader {...base} />);
    expect(screen.getByText("Classic offers").tagName).not.toBe("BUTTON");
    rerender(<CockpitHeader {...base} onEditFlow={onEditFlow} />);
    fireEvent.click(screen.getByRole("button", { name: /classic offers/i }));
    expect(onEditFlow).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run** → FAIL (no module).

- [ ] **Step 3: Implement `CockpitHeader.tsx`**

Build from the prototype header markup, mapped to Tailwind + shadcn `Button`. Meter segments from `slots` + `confirmedCount`/`acceptedCount` (same tone rules as `RowPeek`). Tab bar filters `!t.hidden`; active tab gets `border-b-2 border-accent-500 text-foreground font-semibold`, others `text-muted-foreground`. Keep the existing "Generate hire order" `Button` semantics (disabled + title) verbatim from `ShowDateDetailSheet.tsx:605-615`. Status dot color from `statusTone` → `var(--green-600)`/`var(--amber-600)`/`var(--text-muted)`.

- [ ] **Step 4: Run** → PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/date/CockpitHeader.tsx src/components/shows/date/CockpitHeader.test.tsx
git commit -m "extract CockpitHeader presentational component"
```

---

### Task 8: Extract `CockpitRail`

**Files:**
- Create: `src/components/shows/date/CockpitRail.tsx`
- Test: `src/components/shows/date/CockpitRail.test.tsx`

**Interfaces:**
- Consumes: `ActivityItem` (Task 6).
- Produces:
  ```ts
  export interface CockpitRailProps {
    times: string | null;        // "14:00 / 19:30"
    venue: string | null; city: string | null;
    source: "airtable" | "manual";
    castChips: Array<{ label: string; kind: "inherited" | "override" }>;
    skillChips: string[];
    activity: ActivityItem[];    // pre-derived (Task 6); rail formats iso
    chatUnread: number; chatPreview: string | null;
    onEditSetup: () => void;     // jump to Setup tab
  }
  export function CockpitRail(props: CockpitRailProps): JSX.Element
  ```
  Purely presentational. `iso` → short time/day via existing `formatDateWithWeekday`/`Intl` (mirror `bookingCockpit.ts`'s Berlin-safe day key for date-only formatting).

- [ ] **Step 1: Write the failing test** — assert: times/venue/city render; each `castChip` and `skillChip` shows; activity texts render in order; `chatUnread` badge shows when > 0; "Edit date setup" button fires `onEditSetup`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** from the prototype rail markup (Date / Eligibility / Activity / Chat sections), Tailwind + tokens.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/date/CockpitRail.tsx src/components/shows/date/CockpitRail.test.tsx
git commit -m "extract CockpitRail presentational component"
```

---

### Task 9: Re-lay-out `ShowDateDetailSheet` into the cockpit

This is the integration task: keep every query, mutation, and gate from the current file; move the rendered sections into the cockpit shell (`CockpitHeader` + `CockpitRail` + tab panels); decompose the `booking_flow` gate across the Cast and Offers tabs; update the two test files. Verified by the updated existing suites + new component tests + the browser.

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (render body 583-956; add `activeTab` state; import `CockpitHeader`/`CockpitRail`, `computeHeaderCta`, `buildActivity`)
- Modify: `src/components/shows/ShowDateDetailSheet.test.tsx` (tab-activate selectors)
- Modify: `src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx` (rewrite to the Cast/Offers tab gating, same invariants)

**Interfaces:**
- Consumes: `CockpitHeader` (7), `CockpitRail` (8), `computeHeaderCta` (5), `buildActivity` (6), all existing hooks/mutations already in the file.

- [ ] **Step 1: Add tab state + derived header/rail values**

Inside the component, after the existing derived values:

```tsx
const [activeTab, setActiveTab] = useState<CockpitTab>('cast');
const bookings = bookingsForDate ?? [];
const funnel = computeFunnel(bookings);
const confirmedCount = funnel.confirmedMain + funnel.confirmedUnderstudy;
const acceptedCount = bookings.filter(b => b.status === 'soft_booked').length;
const totalSlots = slotConfig ? slotConfig.main_cast + slotConfig.understudies : null;
const highestOpenTier = (openedQ.data ?? []).filter(t => !t.closedAt)
  .reduce<number | null>((m, t) => Math.max(m ?? 0, t.tier), null);
const workflowCta = computeHeaderCta({
  artistAcceptance: flow.artist_acceptance, acceptedCount, confirmedCount,
  totalSlots, openTier: highestOpenTier, maxTier: 3,
});
// capability gate per CTA kind; hide if not permitted
const ctaAllowed =
  workflowCta.kind === 'confirm'  ? canConfirmBookings :
  workflowCta.kind === 'openTier' ? canRunOfferEngine :
  workflowCta.kind === 'book'     ? canManage :
  workflowCta.kind === 'reviewOffers' ? canManage : false;
```

CTA handler maps kind → existing action:
```tsx
function onWorkflowCta() {
  switch (workflowCta.kind) {
    case 'confirm': {
      const ids = bookings.filter(b => b.status === 'soft_booked').map(b => b.id);
      // reuse the existing per-row mutation path or bulkConfirmSoftBooked; keep the
      // existing updateBookingStatus mutation for a single source of truth:
      ids.forEach(id => updateBookingStatus.mutate({ bookingId: id, status: 'confirmed' }));
      break;
    }
    case 'openTier': openOffers.mutate({ tier: (highestOpenTier ?? 0) + 1, skillFilterIds: [] }); break;
    case 'book':
    case 'reviewOffers': setActiveTab('offers'); break;
  }
}
```

- [ ] **Step 2: Replace the render body with the cockpit shell**

Widen `SheetContent` and compose header + rail + tab panels. Skeleton (existing children moved verbatim into panels):

```tsx
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="w-full sm:max-w-[1080px] overflow-y-auto p-0">
    <SheetHeader className="sr-only"><SheetTitle>{title}</SheetTitle></SheetHeader>
    {showDate && (
      <>
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          <CockpitHeader
            title={title} dateLine={format(parseDateOnly(showDate.date), 'EEEE, d MMMM yyyy')}
            metaLine={metaLine} slots={slotConfig}
            confirmedCount={confirmedCount} acceptedCount={acceptedCount}
            statusText={statusText} statusTone={statusTone}
            workflowCta={ctaAllowed && workflowCta.kind !== 'none' ? workflowCta : null}
            onWorkflowCta={onWorkflowCta}
            showGenerateHireOrder={showGenerateHireOrderCta}
            generateDisabled={hireOrderAction.isPending || !canGenerateHireOrders}
            generateTitle={canGenerateHireOrders ? undefined : "You don't have permission to generate hire orders"}
            onGenerate={generateHireOrder}
            flowLabel={flow.artist_acceptance ? 'Classic offers' : 'Direct booking'}
            onEditFlow={canEditBookingSettings ? () => navigate(ROUTES.SETTINGS + '?tab=booking-flow') : undefined}
            tabs={[
              { id: 'cast', label: 'Cast' },
              { id: 'offers', label: flow.artist_acceptance ? 'Offers' : 'Book artists' },
              { id: 'order', label: 'Hire order', hidden: !hireOrdersOn },
              { id: 'chat', label: 'Chat' },
              { id: 'setup', label: 'Setup', hidden: !canManage },
            ]}
            activeTab={activeTab} onTab={setActiveTab}
            devBadge={isEditorMode && isRealAdmin}
          />
        </div>

        <div className="flex items-stretch">
          <CockpitRail /* ...derived props, activity={buildActivity({ bookings, openedTiers: openedQ.data ?? [] })} ... */ />

          <div className="flex-1 p-5 min-h-[520px]">
            {activeTab === 'cast' && (/* Cast panel: gated AssignedArtistsCard — see Step 3 */)}
            {activeTab === 'offers' && (/* Offers/Book panel: gated offers card — see Step 3 */)}
            {activeTab === 'order' && <HireOrdersCard showDateId={showDate.id} showDate={showDate} bookings={bookings} canManage={canManage} />}
            {activeTab === 'chat' && <ChatPanel showDateId={showDate.id} showDate={showDate.date} />}
            {activeTab === 'setup' && canManage && (/* date config + required skills + date actions, moved verbatim from 693-853 */)}
          </div>
        </div>
        <ShowDateFormDialog /* unchanged, 940-950 */ />
      </>
    )}
  </SheetContent>
</Sheet>
```

Move verbatim into the Setup panel: the Date-configuration `Card` (693-792), and the Date-actions block (794-853). Move the cancelled banner (661-668) into the header/rail. `statusText`/`statusTone`/`metaLine`/`title` are computed from the existing values (`referenceLabel(...)`, sessions/venue/city join, and the `computeUpNext`/status signal already present).

- [ ] **Step 3: Decompose the `booking_flow` gate across Cast + Offers**

The current `BookingCardSection` (`ShowDateDetailSheet.tsx:147-185`) wraps the offers card **and** the assigned-artists card in one `ModuleGate`. The cockpit splits them across tabs, so replace the single wrapper with two gated panels that preserve the same invariants (cast stays readable read-only when off; offers replaced by the module notice when off; cast rendered once):

- **Cast panel:** render `AssignedArtistsCard` directly. When `useModuleGate('booking_flow')` is not allowed, render it read-only (`canManage={false} showConfirm={false}`); when allowed, `canManage={canManage} showConfirm={canConfirmBookings}` with the existing `onConfirm`/`onCancel` mutations.
- **Offers panel:** wrap the offers/book card (the current 864-926 children) in `<ModuleGate feature="booking_flow">` so it shows the module notice when off.

Keep `BookingStatusSection` for the header's funnel/up-next data? No — the funnel now renders inside `CockpitHeader` (the meter) and up-next can move to the rail. Remove `BookingStatusSection` from the tree; its two module-gate tests move to assert the header meter / offers-panel gating instead (Step 5). `deriveBookingGroups`, `AssignedArtistsCard`, `TierTimeline`, `DryRunDialog`, `EligibilityBookList` are unchanged and keep their own tests.

- [ ] **Step 4: Update `ShowDateDetailSheet.test.tsx` (tab-activate)**

The capability-gate assertions are unchanged; only navigation changes because controls now live in tabs. For each test, activate the owning tab first:

```tsx
// helper
const clickTab = async (name: RegExp) => fireEvent.click(await screen.findByRole("button", { name }));

// tests 3,4 (Edit schedule) and 5,6 (Delete / Cancel date): open Setup first
await clickTab(/^setup$/i);
// tests 7,8 (TierTimeline canManage): open Offers first
await clickTab(/^offers$/i);
```

Tests 1,2 (Generate hire order — header button) and 9,10 (Confirm/Cancel on the default **Cast** tab) need no navigation. Confirm test 1 still passes: `showGenerateHireOrderCta` derivation is preserved verbatim (it keys off `status === 'fully_filled'` + `hireOrdersOn`, not a recount), and the button stays in the header.

- [ ] **Step 5: Rewrite `ShowDateDetailSheet.moduleGate.test.tsx`**

These tests currently render `BookingCardSection`/`BookingStatusSection` directly. Since Cast/Offers gating is now inside the sheet's tab panels, rewrite them to render the sheet (mocking heavy children as `ShowDateDetailSheet.test.tsx` does) and assert the same invariants:
- `booking_flow` on, Offers tab: offers UI present.
- `booking_flow` off, Offers tab: the module notice replaces the offers UI.
- `booking_flow` off, Cast tab: the confirmed cast is still readable, but no Confirm/Cancel controls.
- Cast rendered exactly once (no duplicate list).
- Header meter present when on; when off, the header shows no funnel/up-next (the pure booking-engine status is gated).

- [ ] **Step 6: Run the full sheet suites + typecheck**

Run: `npx vitest run src/components/shows/ShowDateDetailSheet.test.tsx src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx src/components/shows/date && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS across the sheet + all `date/` sibling suites; clean types.

- [ ] **Step 7: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx src/components/shows/ShowDateDetailSheet.test.tsx src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx
git commit -m "re-lay-out ShowDateDetailSheet as the show date cockpit"
```

---

### Task 10: Whole-suite gates + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Lint, unit, types**

Run:
```bash
npm run lint
npx vitest run --coverage
npx tsc -p tsconfig.app.json --noEmit
```
Expected: lint clean (`--max-warnings 0`), all tests pass, coverage thresholds met, no type errors.

- [ ] **Step 2: Browser — producer cockpit**

Start the dev server (preview_start `{name}` from `.claude/launch.json`; if absent, add a `dev` config). On `/bookings`, open a date: verify header (meter/status/CTA), rail, and each tab (Cast / Offers|Book / Hire order hidden when off / Chat / Setup). Toggle nothing server-side — reflect the org's actual flow. Check light + dark (`resize_window` colorScheme) and a narrow width (rail stacks).

- [ ] **Step 3: Browser — the peek**

On `/bookings`, hover a row (peek appears after ~250ms), press Space on a focused row (peek), press Enter (full cockpit), click Confirm N on an at-risk date, confirm the toast + the row's fill updates.

- [ ] **Step 4: Browser — artist degradation**

Sign in as (or view-as) an artist; open a date from the artist bookings view: verify Cast (read-only), Chat, and the artist Hire-order variant show, and Setup / offer controls / workflow CTA are absent.

- [ ] **Step 5: Screenshot proof + commit any fixes**

Capture cockpit + peek screenshots for the PR. Commit any fixes found:

```bash
git add -A && git commit -m "polish cockpit + peek from browser verification"
```

---

## Self-Review

**Spec coverage:** Cockpit shell (Tasks 7-9) · header CTA (5) · rail + activity (6,8) · flow reflect/no-toggle (7,9) · gate reuse + artist degradation (9, Task 10 Step 4) · peek trigger/keyboard (4) · peek data extension (1) · peek summary + actions (2,3,4) · token mapping (Global Constraints, every UI task) · test preservation (9 Steps 4-5) · browser verification (10). Deferred items (pager, real activity feed, expiry-based at-risk, comment/chase, `/dates/:id`) are out of scope per the spec.

**Placeholder scan:** The only non-literal code blocks are Task 4 Step 1 (page-test body — deliberately a stub with exact assertions, plus a documented fallback to a `useRowPeek`/`<BookingsRow>` unit test) and Task 9 Steps 2-3 (the re-layout references existing line ranges to move verbatim rather than reproducing ~360 lines). Every new module (Tasks 1,2,3,5,6,7 and the `RowPeek`/`CockpitHeader` bodies) has complete code.

**Type consistency:** `DateBookingCounts` (Task 1) → consumed by `computeDatePeek` (2, via `Pick`) and the peek wiring (4). `DatePeek`/`DatePeekSeg` (2) → `RowPeek` (3) + page (4). `HeaderCta` (5) → `CockpitHeader` (7) + sheet (9). `ActivityItem` (6) → `CockpitRail` (8) + sheet (9). `CockpitTab`/`CockpitHeaderProps` (7) → sheet (9). Names checked end-to-end: `computeDatePeek`, `computeHeaderCta`, `buildActivity`, `bulkConfirmSoftBooked`, `fetchBookingCountsByDate`, `RowPeek`, `CockpitHeader`, `CockpitRail`.
