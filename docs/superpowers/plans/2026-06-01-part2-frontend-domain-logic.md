# Part 2 — Frontend Domain Logic (Extraction + Backfill + Bug Crop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend's domain logic testable and tested — backfill the untested pure utilities, extract booking/eligibility derivations out of the 496-line `ShowDateDetailSheet`, move untested hook queries into `src/data/*` data-access functions, and crop any bugs the new tests surface.

**Architecture:** Two complementary patterns, both already proven in Part 0/1:
1. **Pure-function extraction** — domain logic (booking grouping, eligibility derivation, settings-warning computation, date/avatar/filter helpers) moves into pure modules under `src/lib/`. Components/hooks call them; tests drive them directly with plain inputs.
2. **Data-access extraction** — Supabase reads/writes move into `fetchX(client, args)` / `mutateX(client, args)` functions under `src/data/<domain>.ts` that take the client as a parameter. Hooks become thin wrappers passing the `supabase` singleton. Tests drive the data-access functions with the call-recording fake (`src/test/supabaseFake.ts`) and assert the right table/filters were queried.

No production behavior changes except explicitly-approved bug fixes. Every refactor is behavior-preserving and covered by a test written **before** the refactor.

**Tech Stack:** Vitest + jsdom + @testing-library/react; `src/test/` harness (`createFakeSupabase`, `renderHookWithProviders`, fixtures); TypeScript types derived from `Database`.

---

## Conventions for every task in this plan

- **Test runner (this environment has no `npx`/`node` on PATH — Deno manages `node_modules`):**
  ```bash
  export PATH="$HOME/.deno/bin:$PATH"
  deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run <path>
  ```
- **Lint:** `deno run -A --unstable-bare-node-builtins node_modules/.bin/eslint <path>` (or project `npm run lint` equivalent if a node runner becomes available).
- **Data-access tests** import the real `src/data/*` function + `createFakeSupabase` + fixtures. Assert on `fake.calls` (table/method/args), never re-implement the query.
- **Pure-function tests** import the real `src/lib/*` function and assert on return values for representative + edge inputs.
- **Bug-handling protocol (carried over from Part 1):**
  - Real bug with unambiguous correct behavior → write a failing regression test, fix it, log it.
  - Behavior that is ambiguous / might-be-intentional → write a **characterization** test documenting current behavior, add a row to the bug log, and do **not** change behavior without user confirmation.
  - Never weaken a test to make it pass.
- **Bug log:** append findings to `docs/superpowers/part2-bug-log.md` (created in Task 0).

---

## File Structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `docs/superpowers/part2-bug-log.md` | Running bug/characterization log for Part 2 | Create |
| `src/lib/dates.test.ts` | Tests for timezone-safe date helpers | Create |
| `src/lib/avatar.test.ts` | Tests for deterministic avatar palette | Create |
| `src/components/filters/filterUtils.test.ts` | Tests for `inTimeframe` + `applySort` | Create |
| `src/lib/bookings.ts` | Pure booking/eligibility derivations | Create |
| `src/lib/bookings.test.ts` | Tests for the above | Create |
| `src/components/shows/ShowDateDetailSheet.tsx` | Refactor to call `src/lib/bookings.ts` (no behavior change) | Modify |
| `src/data/notifications.ts` | `fetchNotifications` / `markNotificationRead` / `markAllNotificationsRead` | Create |
| `src/data/notifications.test.ts` | Tests for the above | Create |
| `src/hooks/useNotifications.ts` | Thin wrappers over `src/data/notifications.ts` | Modify |
| `src/data/skills.ts` | `fetchSkills` / `fetchArtistSkills` / `createSkill` | Create |
| `src/data/skills.test.ts` | Tests for the above | Create |
| `src/hooks/useSkills.ts` | Thin wrappers over `src/data/skills.ts` | Modify |
| `src/lib/settings.ts` | Pure `dedupeProgramPairs` + `computeSchedulingWarnings` | Create |
| `src/lib/settings.test.ts` | Tests for the above | Create |
| `src/data/settings.ts` | `fetchProgramSubProgramPairs` / `fetchSlotDefaults` | Create |
| `src/data/settings.test.ts` | Tests for the above | Create |
| `src/hooks/useSettingsWarnings.ts` | Thin wrapper over `src/lib/settings.ts` + `src/data/settings.ts` | Modify |

---

## Phase 1 — Pure utility backfill (zero refactor risk)

### Task 0: Create the Part 2 bug log

**Files:**
- Create: `docs/superpowers/part2-bug-log.md`

- [ ] **Step 1: Create the bug log skeleton**

```markdown
# Part 2 — Frontend Domain Logic — Bug & Characterization Log

Status legend: HIGH / MED / LOW severity; FIXED / CHARACTERIZED (documented current behavior, no change) / DEFERRED.

| Area | Severity | Status | Description |
|------|----------|--------|-------------|
| _(none yet)_ | | | |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/part2-bug-log.md
git commit -m "add part 2 frontend bug log skeleton"
```

---

### Task 1: Test `src/lib/dates.ts` (timezone-safe helpers)

**Files:**
- Test: `src/lib/dates.test.ts`
- Reference (do not modify unless a real bug is found): `src/lib/dates.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseDateOnly, formatDateDMY, formatDateWithWeekday, toDateKey } from "./dates";

describe("parseDateOnly", () => {
  it("parses a YYYY-MM-DD string at local midnight (no UTC drift)", () => {
    const d = parseDateOnly("2026-04-23");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(0);
  });

  it("round-trips with toDateKey", () => {
    expect(toDateKey(parseDateOnly("2026-12-31"))).toBe("2026-12-31");
    expect(toDateKey(parseDateOnly("2026-01-01"))).toBe("2026-01-01");
  });
});

describe("formatDateDMY", () => {
  it("formats a string as dd/MM/yyyy", () => {
    expect(formatDateDMY("2026-04-23")).toBe("23/04/2026");
  });
  it("zero-pads single-digit day and month", () => {
    expect(formatDateDMY("2026-01-05")).toBe("05/01/2026");
  });
  it("accepts a Date object", () => {
    expect(formatDateDMY(new Date(2026, 0, 5))).toBe("05/01/2026");
  });
});

describe("formatDateWithWeekday", () => {
  it("prefixes the abbreviated weekday", () => {
    // 2026-04-23 is a Thursday
    expect(formatDateWithWeekday("2026-04-23")).toBe("Thu, 23/04/2026");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (helpers already exist)**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/dates.test.ts`
Expected: PASS. If any case FAILS, that is a real timezone/format bug — log it in `part2-bug-log.md`, confirm the correct behavior with the spec (DDMMYYYY, timezone-safe), and fix `dates.ts`. Do **not** edit the test to match a wrong output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dates.test.ts docs/superpowers/part2-bug-log.md
git commit -m "test src/lib/dates timezone-safe helpers"
```

---

### Task 2: Test `src/lib/avatar.ts` (deterministic palette)

**Files:**
- Test: `src/lib/avatar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { getAvatarTone } from "./avatar";

describe("getAvatarTone", () => {
  it("is deterministic for the same seed", () => {
    expect(getAvatarTone("Alice")).toEqual(getAvatarTone("Alice"));
  });

  it("always returns a palette entry with bg + text hex", () => {
    for (const seed of ["", "a", "Alice", "a very long name with spaces", "🎭"]) {
      const tone = getAvatarTone(seed);
      expect(tone.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(tone.text).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("handles the empty string without throwing", () => {
    expect(() => getAvatarTone("")).not.toThrow();
  });

  it("distributes different seeds across more than one tone", () => {
    const tones = new Set(
      ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"].map((s) => getAvatarTone(s).bg),
    );
    expect(tones.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/avatar.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/avatar.test.ts
git commit -m "test src/lib/avatar deterministic palette"
```

---

### Task 3: Test `src/components/filters/filterUtils.ts`

**Files:**
- Test: `src/components/filters/filterUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { inTimeframe, applySort } from "./filterUtils";

const d = (s: string) => new Date(s + "T12:00:00");

describe("inTimeframe", () => {
  it("returns true when no bounds are set", () => {
    expect(inTimeframe(d("2026-04-23"), { from: null, to: null })).toBe(true);
    expect(inTimeframe(null, { from: null, to: null })).toBe(true);
  });

  it("returns false for a null date when a bound is set", () => {
    expect(inTimeframe(null, { from: d("2026-01-01"), to: null })).toBe(false);
  });

  it("excludes dates before `from`", () => {
    expect(inTimeframe(d("2025-12-31"), { from: d("2026-01-01"), to: null })).toBe(false);
    expect(inTimeframe(d("2026-01-01"), { from: d("2026-01-01"), to: null })).toBe(true);
  });

  it("includes the entire `to` day (end-of-day inclusivity)", () => {
    // a time late on the `to` day must still be inside the window
    expect(inTimeframe(new Date("2026-06-30T23:30:00"), { from: null, to: d("2026-06-30") })).toBe(true);
    expect(inTimeframe(d("2026-07-01"), { from: null, to: d("2026-06-30") })).toBe(false);
  });
});

describe("applySort", () => {
  type Item = { name: string; date: Date | null };
  const getName = (i: Item) => i.name;
  const getDate = (i: Item) => i.date;
  const items: Item[] = [
    { name: "Charlie", date: d("2026-03-01") },
    { name: "alice", date: d("2026-01-01") },
    { name: "Bob", date: d("2026-02-01") },
  ];

  it("sorts alpha ascending case-insensitively", () => {
    expect(applySort(items, "alpha_asc", getName, getDate).map(getName)).toEqual(["alice", "Bob", "Charlie"]);
  });

  it("sorts alpha descending", () => {
    expect(applySort(items, "alpha_desc", getName, getDate).map(getName)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("sorts chrono ascending then descending", () => {
    expect(applySort(items, "chrono_asc", getName, getDate).map(getName)).toEqual(["alice", "Bob", "Charlie"]);
    expect(applySort(items, "chrono_desc", getName, getDate).map(getName)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("pushes null dates to the end in chrono_asc", () => {
    const withNull: Item[] = [{ name: "X", date: null }, { name: "Y", date: d("2026-01-01") }];
    expect(applySort(withNull, "chrono_asc", getName, getDate).map(getName)).toEqual(["Y", "X"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    applySort(items, "alpha_asc", getName, getDate);
    expect(items).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/components/filters/filterUtils.test.ts`
Expected: PASS. (Note: `chrono_desc` with null dates places nulls first because `+Infinity * -1 = -Infinity`; if a case fails, log the actual behavior as a characterization finding rather than editing the assertion blindly — decide whether it is a bug.)

- [ ] **Step 3: Commit**

```bash
git add src/components/filters/filterUtils.test.ts
git commit -m "test filterUtils inTimeframe + applySort"
```

---

## Phase 2 — Extract booking/eligibility derivations out of ShowDateDetailSheet

### Task 4: Create pure `src/lib/bookings.ts` + tests

**Files:**
- Create: `src/lib/bookings.ts`
- Test: `src/lib/bookings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { deriveBookingGroups, computeInheritedCastIds, bookingStatusUpdate } from "./bookings";

type B = { artist_id: string; status: string; is_understudy: boolean };
const b = (o: Partial<B>): B => ({ artist_id: "a1", status: "suggested", is_understudy: false, ...o });

describe("deriveBookingGroups", () => {
  it("excludes cancelled bookings from every group", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed" }),
      b({ artist_id: "a2", status: "cancelled" }),
    ]);
    expect(groups.active).toHaveLength(1);
    expect(groups.bookedArtistIds.has("a2")).toBe(false);
  });

  it("splits main vs understudy", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", is_understudy: false }),
      b({ artist_id: "a2", is_understudy: true }),
    ]);
    expect(groups.main.map((x) => x.artist_id)).toEqual(["a1"]);
    expect(groups.understudy.map((x) => x.artist_id)).toEqual(["a2"]);
  });

  it("counts confirmed main and understudy separately", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed", is_understudy: false }),
      b({ artist_id: "a2", status: "soft_booked", is_understudy: false }),
      b({ artist_id: "a3", status: "confirmed", is_understudy: true }),
      b({ artist_id: "a4", status: "cancelled", is_understudy: false }),
    ]);
    expect(groups.confirmedMainCount).toBe(1);
    expect(groups.confirmedUnderstudyCount).toBe(1);
  });

  it("handles null/undefined input", () => {
    expect(deriveBookingGroups(null).active).toEqual([]);
    expect(deriveBookingGroups(undefined).bookedArtistIds.size).toBe(0);
  });
});

describe("computeInheritedCastIds", () => {
  it("returns eligibility ids minus overrides", () => {
    const result = computeInheritedCastIds(["c1", "c2", "c3"], new Set(["c2"]));
    expect([...result].sort()).toEqual(["c1", "c3"]);
  });
  it("handles null eligibility", () => {
    expect(computeInheritedCastIds(null, new Set(["c1"])).size).toBe(0);
  });
});

describe("bookingStatusUpdate", () => {
  const now = new Date("2026-06-01T10:00:00.000Z");
  it("stamps confirmed_at when confirming", () => {
    expect(bookingStatusUpdate("confirmed", now)).toEqual({
      status: "confirmed",
      confirmed_at: now.toISOString(),
    });
  });
  it("stamps cancelled_at when cancelling", () => {
    expect(bookingStatusUpdate("cancelled", now)).toEqual({
      status: "cancelled",
      cancelled_at: now.toISOString(),
    });
  });
  it("stamps no timestamp for soft_booked (characterizes current behavior — does NOT clear stale stamps)", () => {
    expect(bookingStatusUpdate("soft_booked", now)).toEqual({ status: "soft_booked" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/bookings.test.ts`
Expected: FAIL — `Failed to resolve import "./bookings"`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Pure booking/eligibility derivations extracted from ShowDateDetailSheet.
 * No Supabase, no React — safe to unit-test directly.
 */

export interface BookingLike {
  artist_id: string;
  status: string;
  is_understudy: boolean;
}

export interface BookingGroups<T extends BookingLike> {
  /** All non-cancelled bookings. */
  active: T[];
  /** Active, non-understudy. */
  main: T[];
  /** Active understudies. */
  understudy: T[];
  /** Set of artist_ids with any active booking. */
  bookedArtistIds: Set<string>;
  /** Count of confirmed main-cast bookings. */
  confirmedMainCount: number;
  /** Count of confirmed understudy bookings. */
  confirmedUnderstudyCount: number;
}

export function deriveBookingGroups<T extends BookingLike>(
  bookings: T[] | null | undefined,
): BookingGroups<T> {
  const active = (bookings ?? []).filter((b) => b.status !== "cancelled");
  const main = active.filter((b) => !b.is_understudy);
  const understudy = active.filter((b) => b.is_understudy);
  return {
    active,
    main,
    understudy,
    bookedArtistIds: new Set(active.map((b) => b.artist_id)),
    confirmedMainCount: main.filter((b) => b.status === "confirmed").length,
    confirmedUnderstudyCount: understudy.filter((b) => b.status === "confirmed").length,
  };
}

/** Eligibility-derived cast ids, minus any date-level overrides. */
export function computeInheritedCastIds(
  eligibilityCastIds: string[] | null | undefined,
  overrideCastIds: Set<string>,
): Set<string> {
  return new Set((eligibilityCastIds ?? []).filter((cid) => !overrideCastIds.has(cid)));
}

/**
 * Build the `bookings` update payload for a status transition.
 *
 * NOTE: matches current production behavior exactly — it only *sets*
 * confirmed_at / cancelled_at and never clears a stale stamp on the reverse
 * transition. See part2-bug-log.md ("booking timestamp never cleared").
 */
export function bookingStatusUpdate(status: string, now: Date): Record<string, unknown> {
  const updates: Record<string, unknown> = { status };
  if (status === "confirmed") updates.confirmed_at = now.toISOString();
  if (status === "cancelled") updates.cancelled_at = now.toISOString();
  return updates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/bookings.test.ts`
Expected: PASS.

- [ ] **Step 5: Log the timestamp characterization**

Append a row to `docs/superpowers/part2-bug-log.md`:

```markdown
| bookingStatusUpdate | LOW | CHARACTERIZED | `confirmed_at`/`cancelled_at` are only ever set, never cleared. Re-activating a cancelled booking (cancelled → soft_booked) or un-confirming (confirmed → soft_booked) leaves the stale timestamp in place. Documented by test; no change made pending product decision on whether reverse transitions should clear stamps. |
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/bookings.ts src/lib/bookings.test.ts docs/superpowers/part2-bug-log.md
git commit -m "extract pure booking derivations to src/lib/bookings"
```

---

### Task 5: Refactor `ShowDateDetailSheet` to use `src/lib/bookings.ts` (no behavior change)

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx`

- [ ] **Step 1: Add the import**

Near the other `@/lib` / `@/hooks` imports at the top of the file, add:

```ts
import { deriveBookingGroups, computeInheritedCastIds, bookingStatusUpdate } from '@/lib/bookings';
```

- [ ] **Step 2: Replace the inline derivation block**

Replace this block (currently lines ~117-145):

```ts
  const activeBookings = useMemo(
    () => (bookingsForDate ?? []).filter(b => b.status !== 'cancelled'),
    [bookingsForDate]
  );
  const mainBookings = useMemo(() => activeBookings.filter(b => !b.is_understudy), [activeBookings]);
  const understudyBookings = useMemo(() => activeBookings.filter(b => b.is_understudy), [activeBookings]);

  const bookedArtistIds = useMemo(
    () => new Set(activeBookings.map(b => b.artist_id)),
    [activeBookings]
  );

  const overrideCastIds = useMemo(
    () => new Set((dateCastOverrides ?? []).map(r => r.cast_id)),
    [dateCastOverrides]
  );
  const inheritedCastIds = useMemo(
    () => new Set((eligibility?.castIds ?? []).filter(cid => !overrideCastIds.has(cid))),
    [eligibility, overrideCastIds]
  );

  const confirmedMainCount = useMemo(
    () => activeBookings.filter(b => b.status === 'confirmed' && !b.is_understudy).length,
    [activeBookings]
  );
  const confirmedUnderstudyCount = useMemo(
    () => activeBookings.filter(b => b.status === 'confirmed' && b.is_understudy).length,
    [activeBookings]
  );
```

with:

```ts
  const {
    active: activeBookings,
    main: mainBookings,
    understudy: understudyBookings,
    bookedArtistIds,
    confirmedMainCount,
    confirmedUnderstudyCount,
  } = useMemo(() => deriveBookingGroups(bookingsForDate ?? []), [bookingsForDate]);

  const overrideCastIds = useMemo(
    () => new Set((dateCastOverrides ?? []).map(r => r.cast_id)),
    [dateCastOverrides]
  );
  const inheritedCastIds = useMemo(
    () => computeInheritedCastIds(eligibility?.castIds, overrideCastIds),
    [eligibility, overrideCastIds]
  );
```

- [ ] **Step 3: Replace the inline status-update payload**

In the `updateBookingStatus` mutation, replace (currently lines ~210-214):

```ts
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const updates: Record<string, unknown> = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
      const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
      if (error) throw error;
    },
```

with:

```ts
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const updates = bookingStatusUpdate(status, new Date());
      const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
      if (error) throw error;
    },
```

- [ ] **Step 4: Verify type-check, lint, build all stay green**

Run:
```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/bookings.test.ts
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
```
Expected: build succeeds; no TypeScript errors referencing `ShowDateDetailSheet.tsx`. If `useMemo` is now unused anywhere else in the file, confirm it is still imported only if still used (it is — `overrideCastIds`/`inheritedCastIds` still use it).

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx
git commit -m "refactor ShowDateDetailSheet to use src/lib/bookings derivations"
```

---

## Phase 3 — Data-access extraction for untested hooks

### Task 6: Extract notifications data-access + tests + thin hooks

**Files:**
- Create: `src/data/notifications.ts`
- Test: `src/data/notifications.test.ts`
- Modify: `src/hooks/useNotifications.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from "./notifications";

describe("fetchNotifications", () => {
  it("queries notifications by user_id, newest first, limited to 50", async () => {
    const rows = [{ id: "n1" }, { id: "n2" }];
    const fake = createFakeSupabase({ notifications: { data: rows, error: null } });
    const result = await fetchNotifications(fake as never, "u1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "order", args: ["created_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "limit", args: [50] });
  });

  it("returns [] when data is null", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    expect(await fetchNotifications(fake as never, "u1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: { message: "boom" } } });
    await expect(fetchNotifications(fake as never, "u1")).rejects.toBeTruthy();
  });
});

describe("markNotificationRead", () => {
  it("updates read=true filtered by id", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    await markNotificationRead(fake as never, "n1");
    expect(fake.calls).toContainEqual({ table: "notifications", method: "update", args: [{ read: true }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["id", "n1"] });
  });
});

describe("markAllNotificationsRead", () => {
  it("updates read=true filtered by user_id and unread only", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    await markAllNotificationsRead(fake as never, "u1");
    expect(fake.calls).toContainEqual({ table: "notifications", method: "update", args: [{ read: true }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["read", false] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/notifications.test.ts`
Expected: FAIL — `Failed to resolve import "./notifications"`.

- [ ] **Step 3: Write the data-access module**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/** Fetch the 50 newest notifications for a user. */
export async function fetchNotifications(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Notification[]> {
  const { data, error } = await client
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

/** Mark a single notification read. */
export async function markNotificationRead(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}

/** Mark all of a user's unread notifications read. */
export async function markAllNotificationsRead(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Make the hooks thin wrappers**

Replace `src/hooks/useNotifications.ts` with:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/data/notifications';

export function useNotifications() {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: () => fetchNotifications(supabase, userId!),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(supabase, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      await markAllNotificationsRead(supabase, user.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}
```

- [ ] **Step 6: Verify build + the new test stay green**

Run:
```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/notifications.test.ts
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
```
Expected: PASS + build success.

- [ ] **Step 7: Commit**

```bash
git add src/data/notifications.ts src/data/notifications.test.ts src/hooks/useNotifications.ts
git commit -m "extract notifications data-access; thin useNotifications hooks"
```

---

### Task 7: Extract skills data-access + tests + thin hooks

**Files:**
- Create: `src/data/skills.ts`
- Test: `src/data/skills.test.ts`
- Modify: `src/hooks/useSkills.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchSkills, fetchArtistSkills, createSkill } from "./skills";

describe("fetchSkills", () => {
  it("selects id,name ordered by name", async () => {
    const rows = [{ id: "s1", name: "Acro" }];
    const fake = createFakeSupabase({ skills: { data: rows, error: null } });
    expect(await fetchSkills(fake as never)).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "skills", method: "select", args: ["id, name"] });
    expect(fake.calls).toContainEqual({ table: "skills", method: "order", args: ["name"] });
  });
});

describe("fetchArtistSkills", () => {
  it("flattens the joined skill rows and sorts by name", async () => {
    const joined = [
      { skill: { id: "s2", name: "Zebra" } },
      { skill: { id: "s1", name: "Acro" } },
      { skill: null }, // defensive: a dangling join row
    ];
    const fake = createFakeSupabase({ artist_skills: { data: joined, error: null } });
    const result = await fetchArtistSkills(fake as never, "a1");
    expect(result).toEqual([
      { id: "s1", name: "Acro" },
      { id: "s2", name: "Zebra" },
    ]);
    expect(fake.calls).toContainEqual({ table: "artist_skills", method: "eq", args: ["artist_id", "a1"] });
  });
});

describe("createSkill", () => {
  it("trims the name and inserts it", async () => {
    const fake = createFakeSupabase({ skills: { data: { id: "s9", name: "Juggling" }, error: null } });
    const result = await createSkill(fake as never, "  Juggling  ");
    expect(result).toEqual({ id: "s9", name: "Juggling" });
    expect(fake.calls).toContainEqual({ table: "skills", method: "insert", args: [{ name: "Juggling" }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/skills.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the data-access module**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Skill = { id: string; name: string };

/** All skills, alphabetical. */
export async function fetchSkills(client: SupabaseClient<Database>): Promise<Skill[]> {
  const { data, error } = await client.from("skills").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

/** Skills attached to an artist, flattened from the join and sorted by name. */
export async function fetchArtistSkills(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<Skill[]> {
  const { data, error } = await client
    .from("artist_skills")
    .select("skill:skills(id, name)")
    .eq("artist_id", artistId);
  if (error) throw error;
  return ((data ?? []) as unknown as { skill: Skill | null }[])
    .map((r) => r.skill)
    .filter((s): s is Skill => Boolean(s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Create a skill from a (trimmed) name. */
export async function createSkill(
  client: SupabaseClient<Database>,
  name: string,
): Promise<Skill> {
  const trimmed = name.trim();
  const { data, error } = await client
    .from("skills")
    .insert({ name: trimmed })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as Skill;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Make the hooks thin wrappers**

Replace `src/hooks/useSkills.ts` with:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchSkills, fetchArtistSkills, createSkill, type Skill } from '@/data/skills';

export type { Skill };

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => fetchSkills(supabase),
  });
}

export function useArtistSkills(artistId: string | null | undefined) {
  return useQuery({
    queryKey: ['skills', 'for-artist', artistId],
    enabled: !!artistId,
    queryFn: () => fetchArtistSkills(supabase, artistId!),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createSkill(supabase, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}
```

- [ ] **Step 6: Verify build + tests stay green**

Run:
```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/skills.test.ts
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
```
Expected: PASS + build success. (Note: `Skill` is re-exported so existing `import { Skill } from '@/hooks/useSkills'` call sites keep compiling.)

- [ ] **Step 7: Commit**

```bash
git add src/data/skills.ts src/data/skills.test.ts src/hooks/useSkills.ts
git commit -m "extract skills data-access; thin useSkills hooks"
```

---

### Task 8: Extract settings-warnings logic (pure + data-access) + tests + thin hook

**Files:**
- Create: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`
- Create: `src/data/settings.ts`
- Test: `src/data/settings.test.ts`
- Modify: `src/hooks/useSettingsWarnings.ts`

- [ ] **Step 1: Write the failing pure-logic test**

```ts
import { describe, it, expect } from "vitest";
import { dedupeProgramPairs, computeSchedulingWarnings } from "./settings";

describe("dedupeProgramPairs", () => {
  it("dedupes by (program, sub_program) and drops null pairs", () => {
    const out = dedupeProgramPairs([
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "y" },
      { program: null, sub_program: "z" },
      { program: "B", sub_program: null },
    ]);
    expect(out).toEqual([
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "y" },
    ]);
  });
});

describe("computeSchedulingWarnings", () => {
  const pairs = [
    { program: "A", sub_program: "x" },
    { program: "A", sub_program: "y" },
  ];
  it("counts pairs with no slot defaults configured", () => {
    const defaults = { A: { x: { main_cast: 2, understudies: 1 } } };
    const w = computeSchedulingWarnings(pairs, defaults);
    expect(w.schedulingWarnings).toBe(1); // A/y is unconfigured
    expect(w.hasAnyWarning).toBe(true);
  });
  it("reports zero when all pairs are configured", () => {
    const defaults = {
      A: { x: { main_cast: 2, understudies: 1 }, y: { main_cast: 1, understudies: 0 } },
    };
    const w = computeSchedulingWarnings(pairs, defaults);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });
  it("handles null inputs", () => {
    expect(computeSchedulingWarnings(null, null).schedulingWarnings).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/settings.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the pure module**

```ts
import type { NestedSlotDefaults } from "@/hooks/useSubProgramSlots";

export interface ProgramPair {
  program: string;
  sub_program: string;
}

export interface SettingsWarnings {
  /** Number of (program, sub_program) combinations with no slot defaults configured. */
  schedulingWarnings: number;
  /** True when any warning exists. */
  hasAnyWarning: boolean;
}

/** Dedupe raw shows rows into distinct, fully-populated (program, sub_program) pairs. */
export function dedupeProgramPairs(
  rows: { program: string | null; sub_program: string | null }[] | null | undefined,
): ProgramPair[] {
  const seen = new Set<string>();
  const out: ProgramPair[] = [];
  (rows ?? []).forEach((r) => {
    if (!r.program || !r.sub_program) return;
    const key = `${r.program}::${r.sub_program}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ program: r.program, sub_program: r.sub_program });
    }
  });
  return out;
}

/** Count program/sub-program pairs that lack a slot-defaults entry. */
export function computeSchedulingWarnings(
  pairs: ProgramPair[] | null | undefined,
  slotDefaults: NestedSlotDefaults | null | undefined,
): SettingsWarnings {
  const unconfigured = (pairs ?? []).filter(
    (p) => !slotDefaults?.[p.program]?.[p.sub_program],
  );
  const schedulingWarnings = unconfigured.length;
  return { schedulingWarnings, hasAnyWarning: schedulingWarnings > 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing data-access test**

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchProgramSubProgramPairs, fetchSlotDefaults } from "./settings";

describe("fetchProgramSubProgramPairs", () => {
  it("selects non-null program/sub_program from shows and dedupes", async () => {
    const rows = [
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "x" },
    ];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const result = await fetchProgramSubProgramPairs(fake as never);
    expect(result).toEqual([{ program: "A", sub_program: "x" }]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "select", args: ["program, sub_program"] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "not", args: ["program", "is", null] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "not", args: ["sub_program", "is", null] });
  });
});

describe("fetchSlotDefaults", () => {
  it("returns the value object", async () => {
    const value = { A: { x: { main_cast: 2, understudies: 1 } } };
    const fake = createFakeSupabase({ app_settings: { data: { value }, error: null } });
    expect(await fetchSlotDefaults(fake as never)).toEqual(value);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", "sub_program_slots_defaults"] });
  });
  it("returns {} when no row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    expect(await fetchSlotDefaults(fake as never)).toEqual({});
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/settings.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 7: Write the data-access module**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { NestedSlotDefaults } from "@/hooks/useSubProgramSlots";
import { dedupeProgramPairs, type ProgramPair } from "@/lib/settings";

/** Distinct (program, sub_program) pairs across all shows. */
export async function fetchProgramSubProgramPairs(
  client: SupabaseClient<Database>,
): Promise<ProgramPair[]> {
  const { data } = await client
    .from("shows")
    .select("program, sub_program")
    .not("program", "is", null)
    .not("sub_program", "is", null);
  return dedupeProgramPairs(data ?? []);
}

/** The sub_program_slots_defaults app_settings value (or {}). */
export async function fetchSlotDefaults(
  client: SupabaseClient<Database>,
): Promise<NestedSlotDefaults> {
  const { data } = await client
    .from("app_settings")
    .select("value")
    .eq("key", "sub_program_slots_defaults")
    .maybeSingle();
  return (data?.value ?? {}) as NestedSlotDefaults;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/data/settings.test.ts`
Expected: PASS.

- [ ] **Step 9: Rewire the hook to use the extracted pieces**

Replace `src/hooks/useSettingsWarnings.ts` with:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { computeSchedulingWarnings, type SettingsWarnings } from '@/lib/settings';
import { fetchProgramSubProgramPairs, fetchSlotDefaults } from '@/data/settings';

export type { SettingsWarnings };

export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');

  const { data: pairs } = useQuery({
    queryKey: ['shows-program-sub-programs'],
    enabled: canView,
    queryFn: () => fetchProgramSubProgramPairs(supabase),
    staleTime: 60_000,
  });

  const { data: slotsSetting } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults'],
    enabled: canView,
    queryFn: () => fetchSlotDefaults(supabase),
    staleTime: 30_000,
  });

  return useMemo(
    () => computeSchedulingWarnings(pairs, slotsSetting),
    [pairs, slotsSetting],
  );
}
```

- [ ] **Step 10: Verify build + tests stay green**

Run:
```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run src/lib/settings.test.ts src/data/settings.test.ts
deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build
```
Expected: PASS + build success. (`SettingsWarnings` is re-exported so existing import sites keep compiling.)

- [ ] **Step 11: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts src/data/settings.ts src/data/settings.test.ts src/hooks/useSettingsWarnings.ts
git commit -m "extract settings-warnings pure + data-access; thin useSettingsWarnings hook"
```

---

## Phase 4 — Wrap

### Task 9: Full suite, lint, build, finalize bug log

**Files:**
- Modify: `docs/superpowers/part2-bug-log.md` (finalize)

- [ ] **Step 1: Run the entire Vitest suite**

Run:
```bash
export PATH="$HOME/.deno/bin:$PATH"
deno run -A --unstable-bare-node-builtins node_modules/.bin/vitest run
```
Expected: all tests pass (the Part 0/1 frontend tests + every new test from this plan).

- [ ] **Step 2: Lint**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/eslint src`
Expected: 0 errors.

- [ ] **Step 3: Production build**

Run: `deno run -A --unstable-bare-node-builtins node_modules/.bin/vite build`
Expected: build succeeds.

- [ ] **Step 4: Finalize the bug log**

Ensure `docs/superpowers/part2-bug-log.md` has a closing summary line listing total findings (the timestamp characterization from Task 4 plus anything Phase 1 surfaced). If any FAIL in Tasks 1/3 turned out to be a real bug, confirm it has its own row with FIXED status and a regression test.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/part2-bug-log.md
git commit -m "finalize part 2 frontend bug log"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage** (roadmap Part 2 = "Data-access extraction across hooks/components; backfill tests; fix bugs"):
- Pure-util backfill (`dates`, `avatar`, `filterUtils`) → Tasks 1-3. ✅
- Extract booking-status logic out of large components → Tasks 4-5. ✅
- Data-access extraction across untested hooks (`useNotifications`, `useSkills`, `useSettingsWarnings`) → Tasks 6-8. ✅
- Fix bugs surfaced → bug-handling protocol in every task + Task 4 characterization + Task 9 finalize. ✅
- `useMyArtist` was already extracted in Part 0 (reference template); `useArtistEligibleDates`/`useEligibleArtists`/`useChatParticipant`/`useSubProgramSlots` already have tests — out of scope here. ✅

**2. Placeholder scan:** No TBD/TODO/"similar to"/"add error handling" — every code step has complete code. ✅

**3. Type consistency:** `Skill` defined in Task 7 and re-exported from the hook; `SettingsWarnings`/`ProgramPair`/`NestedSlotDefaults` consistent between `src/lib/settings.ts` (Task 8 step 3) and `src/data/settings.ts` (Task 8 step 7); `BookingLike`/`BookingGroups` consistent between Task 4 definition and Task 5 usage; `bookingStatusUpdate(status, now)` signature identical in both. ✅

**Deferred to Part 3 (unchanged):** pgTAP gap-fill, e2e expansion, CI coverage gate, regenerate stale `types.ts` (bookings missing `offered_at`/`offer_tier`/`offer_expires_at`/`digest_sent_at`).
