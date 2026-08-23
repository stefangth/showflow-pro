# Get Running: Truthful Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/get-running` board tell the truth about an org's readiness, turn its two dead-end steps into places where the blocking work can actually be done, and let a producer create and require a skill while writing a casting breakdown.

**Architecture:** Three layers, in order. (1) The pure composers (`src/lib/bookings/setupStatus.ts`, `src/lib/getRunning/steps.ts`) stop treating "no counter-example" as completion, which needs two new input signals (`dateCount`, `nonEmptyCastIds`) and one reframed one (`skillsDone` → a real eligibility check). (2) The two step bodies that report a blocking state they cannot clear (`CitiesStep`, `SkillsStep`) gain inline resolution for exactly the thing they block on. (3) `SkillPicker` gains inline skill creation so the casting breakdown is no longer a dead end when the skill catalog is empty. Everything else is validation, copy and affordance repair.

**Tech Stack:** React 18 + TypeScript, Vitest + jsdom + @testing-library/react, TanStack Query v5, Supabase (PostgREST), react-i18next, Tailwind + shadcn/ui.

**Spec:** [`docs/superpowers/specs/2026-08-24-get-running-audit.md`](../specs/2026-08-24-get-running-audit.md) — the published audit (Get Running Teardown, 12 findings, first-run walkthrough on an emptied org). Finding numbers below refer to that document.

## Global Constraints

- **npm only.** `npm ci` to install; never create `bun.lock`/`yarn.lock`/`pnpm-lock.yaml`.
- **UI conventions win.** `docs/ui-conventions.md` is the spec. Check `src/components/ui` (54 primitives) before writing any new component.
- **No raw values.** No hex, no `rgba()`, no `text-[13px]`, no `rounded-[10px]` outside `src/components/ui`. `eslint/ui-conventions.js` runs at `--max-warnings 0`.
- **No solid fixed-light accent backgrounds.** `bg-accent-50/100/200` are lint-banned in feature code; use `bg-accent` / `bg-accent-tint`.
- **13px is the control size.** Use the `fontSize` scale (`text-control`), radius scale (`rounded-s|m|l`), semantic colour tokens.
- **Uppercase text is `<Eyebrow>`.** Status colour comes from `TONES`. Numbers are `<Metric>` (Geist Mono, tabular).
- **No dashes in copy.** Em and en dashes fail CI in both languages. No exclamation marks, no emoji. German is Du-form.
- **Every new i18n key lands in BOTH `en/` and `de/`.** `src/i18n/keyParity.test.ts` fails CI on any gap. Reuse `src/i18n/terms.ts` `TERMS` for domain terms.
- **Tests import the real module.** Never re-implement production logic in a test. Use `src/test/supabaseFake.ts` (`createFakeSupabase`) and `src/test/renderWithProviders.tsx`; never hand-roll `vi.mock('@/integrations/supabase/client')` chains beyond the established `vi.hoisted` idiom.
- **`any` is banned** (lint error). Use an explicit row interface + a single `as unknown as` cast at the query boundary.
- **Never write `show_required_skills` from the client.** It is trigger-derived (`recompute_show_slot_derivations`) and write-locked at the DB level (`supabase/migrations/20260812160000_lock_show_required_skills_cache.sql`). Write `show_slot_required_skills` via `saveShowSlots`.
- **Verification per task:** `npx vitest run <touched test files>`, then before any commit batch: `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`.

## Visual approval gate

Tasks 4, 5 and 6 introduce new user-facing UI. Per the standing owner directive, **mock these up and get explicit approval before implementing them**. Tasks 1, 2, 3 and 8 to 12 are logic, validation and copy and need no mockup.

---

## File Structure

**Modified (logic):**
- `src/data/showDates.ts` — add `fetchShowDateCount`
- `src/data/casts.ts` — add `fetchNonEmptyCastIds`
- `src/data/skills.ts` — add `fetchSkillEligibilityGaps`
- `src/data/eligibility.ts` — `fetchLadderCoverageInputs` returns cast-member data
- `src/lib/bookings/setupStatus.ts` — `dateCount` input; empty casts do not cover
- `src/lib/getRunning/steps.ts` — `hasAnyDates` + `skillsDone` semantics
- `src/hooks/useBookingSetup.ts` — wire the two new queries
- `src/hooks/useGetRunningV3.ts` — wire `hasAnyDates`, new `skillsDone`

**Modified (UI):**
- `src/components/getRunning/v3/steps/CitiesStep.tsx` — no-dates and missing-city states
- `src/components/getRunning/v3/steps/SkillsStep.tsx` — artist assignment panel
- `src/components/skills/SkillPicker.tsx` — inline create + selected check
- `src/components/catalog/CastingBreakdownFields.tsx` — thread create through
- `src/components/hireOrders/setup/LetterheadStep.tsx` — gate Confirm
- `src/components/getRunning/v3/GetRunningBoardV3.tsx` — phase-complete handoff
- `src/components/shows/ShowDateFormDialog.tsx` — past-date warning, city hint
- `src/components/minis/PageMini.tsx` — Example marker

**Created:**
- `src/components/getRunning/v3/steps/DatesMissingCityList.tsx`
- `src/components/getRunning/v3/steps/ArtistSkillAssignList.tsx`

---

## Phase A — Truthful completion

### Task 1: A phase cannot complete without dates

Fixes findings 03 and 04, and the `cities` half of finding 01. `datesCitiesDone` is `datesWithoutCity === 0`, and `datesWithoutCity` counts *future dates lacking a city*, so it is `0` for an org with no dates at all. Adding the first date flips it to `1` and progress runs backwards.

The fix mirrors a pattern this codebase already uses: `setupStatus.ts` guards `ladder`/`eligibility` with `input.hasAnyShows && coverage` precisely so a blank org is not vacuously complete (see the existing test "a blank org with no shows is not vacuously complete even with empty coverage", `src/lib/bookings/setupStatus.test.ts:245`). We extend the same idea to dates.

`dateCount` counts **all non-cancelled dates, past or future**, not future ones. Using future dates would regress the deliberate "an established org between seasons stays complete" behaviour (`setupStatus.test.ts:228`).

**Files:**
- Create: `src/data/showDates.ts` (add to existing file)
- Modify: `src/lib/bookings/setupStatus.ts:58-101` (input type), `:167-216` (compute)
- Modify: `src/lib/getRunning/steps.ts:74-99` (input type), `:156-167` (get_dates steps)
- Modify: `src/hooks/useBookingSetup.ts`
- Modify: `src/hooks/useGetRunningV3.ts:143-168`
- Test: `src/data/showDates.test.ts`, `src/lib/bookings/setupStatus.test.ts`, `src/lib/getRunning/steps.test.ts`

**Interfaces:**
- Produces: `fetchShowDateCount(client: SupabaseClient, orgId: string | null): Promise<number>`
- Produces: `BookingSetupStatusInput.dateCount: number | null`
- Produces: `BookingSetupStatus.hasAnyDates: boolean`
- Produces: `GetRunningInputV3.hasAnyDates: boolean`
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing data-access test**

In `src/data/showDates.test.ts`, add:

```ts
it("counts non-cancelled dates for the org", async () => {
  const client = createFakeSupabase({
    show_dates: { data: null, error: null, count: 7 },
  });
  const n = await fetchShowDateCount(asSupabase(client), "org-1");
  expect(n).toBe(7);
  expect(client.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
});

it("returns 0 when there is no org", async () => {
  const client = createFakeSupabase({});
  expect(await fetchShowDateCount(asSupabase(client), null)).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/data/showDates.test.ts`
Expected: FAIL, `fetchShowDateCount is not a function`.

- [ ] **Step 3: Implement `fetchShowDateCount`**

Append to `src/data/showDates.ts`:

```ts
/** How many non-cancelled dates the org has, past or future. The get-running board
 *  uses this to tell "no dates yet" (first run) from "no upcoming dates" (between
 *  seasons); counting only future dates would make an established org look blank. */
export async function fetchShowDateCount(client: SupabaseClient, orgId: string | null): Promise<number> {
  if (!orgId) return 0;
  const { count, error } = await client
    .from("show_dates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/data/showDates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing composer tests**

In `src/lib/bookings/setupStatus.test.ts`:

```ts
it("reports hasAnyDates false for an org with no dates", () => {
  const s = computeBookingSetupStatus({ ...base, dateCount: 0 });
  expect(s.hasAnyDates).toBe(false);
});

it("reports hasAnyDates true for an org whose only dates are in the past", () => {
  const s = computeBookingSetupStatus({ ...base, dateCount: 4, coverage: { ...base.coverage, futurePairs: [] } });
  expect(s.hasAnyDates).toBe(true);
});

it("treats an unreadable date count as no dates rather than falsely done", () => {
  const s = computeBookingSetupStatus({ ...base, dateCount: null });
  expect(s.hasAnyDates).toBe(false);
});
```

In `src/lib/getRunning/steps.test.ts`:

```ts
it("keeps the cities step outstanding for an org with no dates at all", () => {
  const m = composeGetRunningV3(baseInput({ hasAnyDates: false, datesCitiesDone: true }));
  const dates = m.phases.find((p) => p.key === "get_dates")!;
  expect(dates.steps.find((s) => s.key === "cities")!.done).toBe(false);
});

it("keeps the productions step outstanding for an org with no dates at all", () => {
  const m = composeGetRunningV3(baseInput({ hasAnyDates: false }));
  const dates = m.phases.find((p) => p.key === "get_dates")!;
  expect(dates.steps.find((s) => s.key === "productions")!.done).toBe(false);
  expect(dates.done).toBe(false);
});

it("does not lose a green cities step when the org has dates and every one has a city", () => {
  const m = composeGetRunningV3(baseInput({ hasAnyDates: true, datesCitiesDone: true }));
  const dates = m.phases.find((p) => p.key === "get_dates")!;
  expect(dates.steps.find((s) => s.key === "cities")!.done).toBe(true);
});
```

Add `hasAnyDates: true` to the `base` literal at `steps.test.ts:22-43` so existing cases keep their meaning.

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts src/lib/getRunning/steps.test.ts`
Expected: FAIL on the new cases (`hasAnyDates` missing; cities/productions still `true`).

- [ ] **Step 7: Implement in `setupStatus.ts`**

Add to `BookingSetupStatusInput` (after `artistCount`, around `:80`):

```ts
  /** How many non-cancelled dates the org has, past or future. `null` = unreadable
   *  (loading or a failed read) and is treated as 0, so a step reports outstanding
   *  rather than falsely done. */
  dateCount: number | null;
```

Add to `BookingSetupStatus` (around `:26-40`):

```ts
  /** The org has at least one non-cancelled date. Distinguishes a first-run org from
   *  an established one between seasons; `datesWithoutCity` cannot, since it is 0 for
   *  both. */
  hasAnyDates: boolean;
```

In `computeBookingSetupStatus`, add to the returned object (near `:215`):

```ts
    hasAnyDates: (input.dateCount ?? 0) > 0,
```

- [ ] **Step 8: Implement in `steps.ts`**

Add to `GetRunningInputV3` (after `datesCitiesDone`, around `:83`):

```ts
  /** The org has at least one non-cancelled date. Guards the two get_dates steps that
   *  would otherwise be vacuously true on a blank org: "every date has a city" holds
   *  trivially with no dates, and "review your productions" says nothing about dates. */
  hasAnyDates: boolean;
```

Change the `cities` step's `done` (`:159`) and the `productions` step's `done` (`:162`):

```ts
    // cities
    done: input.hasAnyDates && input.datesCitiesDone,
    // productions
    done: input.hasAnyDates && (bookingStep(input.booking, "slots")?.done ?? false),
```

- [ ] **Step 9: Wire the hooks**

In `src/hooks/useBookingSetup.ts`, add a count query beside the existing artist-count one and pass it through:

```ts
  const dateCount = useQuery({
    queryKey: ["show-dates", "count", orgId],
    queryFn: () => fetchShowDateCount(supabase, orgId),
    enabled: !!orgId,
  });
```

and add `dateCount: dateCount.data ?? null,` to the `computeBookingSetupStatus` input object.

In `src/hooks/useGetRunningV3.ts`, add to the input object built around `:145-168`:

```ts
    hasAnyDates: bookingOn ? booking.status.hasAnyDates : false,
```

- [ ] **Step 10: Run the full affected suite**

Run: `npx vitest run src/data/showDates.test.ts src/lib/bookings src/lib/getRunning src/hooks/useGetRunningV3.test.tsx src/hooks/useBookingSetup.test.tsx`
Expected: PASS. Fix any existing fixture that now needs `dateCount`/`hasAnyDates`.

- [ ] **Step 11: Commit**

```bash
git add src/data/showDates.ts src/data/showDates.test.ts src/lib/bookings/setupStatus.ts src/lib/bookings/setupStatus.test.ts src/lib/getRunning/steps.ts src/lib/getRunning/steps.test.ts src/hooks/useBookingSetup.ts src/hooks/useGetRunningV3.ts
git commit -m "require dates before the get-dates phase can complete"
```

---

### Task 2: An empty cast does not cover a city

Fixes the `coverage` half of finding 01. `resolveCoverage` marks a (show, city) pair covered when some cast holds `priority === 1` for it, without checking that the cast has members. Ranking a 0-member cast first therefore turns "Rank your casts" green while guaranteeing "Nobody who can be asked".

**Files:**
- Modify: `src/data/eligibility.ts:230-260` (`fetchLadderCoverageInputs`)
- Modify: `src/lib/bookings/setupStatus.ts:42-49` (`LadderCoverageInputs`), `:151-165` (`resolveCoverage`)
- Test: `src/data/eligibility.test.ts`, `src/lib/bookings/setupStatus.test.ts`

**Interfaces:**
- Consumes: `LadderCoverageInputs` from Task 1's edits (the shape gained no field there; this task adds one).
- Produces: `LadderCoverageInputs.nonEmptyCastIds: string[]`

- [ ] **Step 1: Write the failing test**

In `src/lib/bookings/setupStatus.test.ts`:

```ts
it("does not count a tier-1 cast with no members as coverage", () => {
  const r = resolveCoverage({
    futurePairs: [{ showId: "s1", cityId: "c1" }],
    showPriorities: [],
    cityPriorities: [{ cityId: "c1", castId: "empty-cast", priority: 1 }],
    nonEmptyCastIds: [],
  });
  expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
});

it("counts a tier-1 cast that has members as coverage", () => {
  const r = resolveCoverage({
    futurePairs: [{ showId: "s1", cityId: "c1" }],
    showPriorities: [],
    cityPriorities: [{ cityId: "c1", castId: "full-cast", priority: 1 }],
    nonEmptyCastIds: ["full-cast"],
  });
  expect(r.uncoveredPairs).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts -t "no members"`
Expected: FAIL, `uncoveredPairs` is `[]` because membership is not consulted.

- [ ] **Step 3: Implement**

Add to `LadderCoverageInputs` (`setupStatus.ts:42-49`):

```ts
  /** Ids of casts with at least one member. A cast with no members cannot be asked,
   *  so ranking it first leaves the pair uncovered however the ladder reads. */
  nonEmptyCastIds: string[];
```

In `resolveCoverage`, build a set once and require it when testing for a tier-1 cast:

```ts
  const staffed = new Set(inputs.nonEmptyCastIds);
```

and change the tier-1 test so a row only counts when `staffed.has(row.castId)`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the fetch**

In `src/data/eligibility.ts`, `fetchLadderCoverageInputs` gains a fourth read and returns `nonEmptyCastIds`:

```ts
  const members = await client.from("cast_members").select("cast_id").eq("org_id", orgId);
  if (members.error) throw members.error;
  const nonEmptyCastIds = [...new Set((members.data ?? []).map((r) => r.cast_id as string))];
```

Add a matching case to `src/data/eligibility.test.ts` asserting the returned `nonEmptyCastIds` dedupes.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run src/data/eligibility.test.ts src/lib/bookings/setupStatus.test.ts`
Expected: PASS. Update any `LadderCoverageInputs` literal in other tests to include `nonEmptyCastIds: []`.

- [ ] **Step 7: Commit**

```bash
git add src/data/eligibility.ts src/data/eligibility.test.ts src/lib/bookings/setupStatus.ts src/lib/bookings/setupStatus.test.ts
git commit -m "an empty cast no longer counts as city coverage"
```

---

### Task 3: The skills step checks eligibility, not catalog size

Reframes the skills half of finding 01. `skillsDone` is `skills.length > 0`, so defining four skills and assigning none reads as done under the label "Set skills on your artists".

The naive fix (require at least one artist-skill link) would permanently block an org that does not use skills, since the step counts toward `complete`. The honest predicate is the functional one: **every skill a part requires is held by at least one active artist.** An org that requires no skills anywhere passes, which is correct rather than vacuous, because nothing is broken. An org that marks "Lead Vocals" required on a part goes red until someone holds it, which closes the loop with Task 6.

**Files:**
- Modify: `src/data/skills.ts` (add `fetchSkillEligibilityGaps`)
- Modify: `src/lib/getRunning/steps.ts:74-99`, `:200`
- Modify: `src/hooks/useGetRunningV3.ts:158`
- Test: `src/data/skills.test.ts`, `src/lib/getRunning/steps.test.ts`

**Interfaces:**
- Consumes: `GetRunningInputV3` as extended by Task 1.
- Produces: `fetchSkillEligibilityGaps(client, orgId): Promise<SkillGap[]>` where `interface SkillGap { skillId: string; name: string }` — required by some part, held by no active artist.
- Produces: `GetRunningInputV3.skillGaps: number` (replaces `skillsDone`)

- [ ] **Step 1: Write the failing composer test**

In `src/lib/getRunning/steps.test.ts` (replace `skillsDone` in `base` with `skillGaps: 0`):

```ts
it("marks skills done when no part requires a skill nobody holds", () => {
  const m = composeGetRunningV3(baseInput({ skillGaps: 0 }));
  const b = m.phases.find((p) => p.key === "bookable")!;
  expect(b.steps.find((s) => s.key === "skills")!.done).toBe(true);
});

it("keeps skills outstanding while a required skill is held by nobody", () => {
  const m = composeGetRunningV3(baseInput({ skillGaps: 2 }));
  const b = m.phases.find((p) => p.key === "bookable")!;
  expect(b.steps.find((s) => s.key === "skills")!.done).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/getRunning/steps.test.ts -t "skills"`
Expected: FAIL, `skillGaps` is not a field.

- [ ] **Step 3: Implement the composer change**

In `GetRunningInputV3`, replace `skillsDone: boolean` with:

```ts
  /** How many skills are required by at least one part but held by no active artist.
   *  0 means the skill model is coherent, including the legitimate case of an org that
   *  requires no skills at all. Replaces a bare "the catalog is non-empty" check, which
   *  read as done while no artist was eligible for anything. */
  skillGaps: number;
```

Change the `skills` step's `done` (`:200`) to `input.skillGaps === 0`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing data test**

In `src/data/skills.test.ts`:

```ts
it("returns skills required by a part that no active artist holds", async () => {
  const client = createFakeSupabase({
    show_required_skills: { data: [{ skill_id: "sk-1" }, { skill_id: "sk-2" }], error: null },
    artist_skills: { data: [{ skill_id: "sk-2" }], error: null },
    skills: { data: [{ id: "sk-1", name: "Lead Vocals" }, { id: "sk-2", name: "Piano" }], error: null },
  });
  const gaps = await fetchSkillEligibilityGaps(asSupabase(client), "org-1");
  expect(gaps).toEqual([{ skillId: "sk-1", name: "Lead Vocals" }]);
});

it("returns no gaps when no part requires a skill", async () => {
  const client = createFakeSupabase({
    show_required_skills: { data: [], error: null },
    artist_skills: { data: [], error: null },
    skills: { data: [], error: null },
  });
  expect(await fetchSkillEligibilityGaps(asSupabase(client), "org-1")).toEqual([]);
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/data/skills.test.ts -t "gap"`
Expected: FAIL, function not defined.

- [ ] **Step 7: Implement `fetchSkillEligibilityGaps`**

Append to `src/data/skills.ts`. Read `show_required_skills` (the trigger-derived cache, read-only), the org's `artist_skills` restricted to active artists, and the skill names:

```ts
export interface SkillGap { skillId: string; name: string }

/** Skills that some part requires but no ACTIVE artist holds. An empty result means the
 *  skill model is coherent, which includes an org that requires no skills at all. Reads
 *  the trigger-maintained `show_required_skills` cache; never write that table. */
export async function fetchSkillEligibilityGaps(client: SupabaseClient, orgId: string | null): Promise<SkillGap[]> {
  if (!orgId) return [];
  const required = await client.from("show_required_skills").select("skill_id").eq("org_id", orgId);
  if (required.error) throw required.error;
  const requiredIds = [...new Set((required.data ?? []).map((r) => r.skill_id as string))];
  if (requiredIds.length === 0) return [];

  const held = await client
    .from("artist_skills")
    .select("skill_id, artists!inner(status)")
    .eq("org_id", orgId)
    .eq("artists.status", "active");
  if (held.error) throw held.error;
  const heldIds = new Set((held.data ?? []).map((r) => (r as { skill_id: string }).skill_id));

  const missing = requiredIds.filter((id) => !heldIds.has(id));
  if (missing.length === 0) return [];

  const named = await client.from("skills").select("id, name").in("id", missing);
  if (named.error) throw named.error;
  return (named.data ?? []).map((s) => ({ skillId: s.id as string, name: s.name as string }));
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/data/skills.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the hook**

In `src/hooks/useGetRunningV3.ts`, replace the `useSkills` line with a gaps query and change the input mapping (`:158`):

```ts
  const skillGaps = useQuery({
    queryKey: ["skills", "gaps", orgId],
    queryFn: () => fetchSkillEligibilityGaps(supabase, orgId),
    enabled: active && isNonArtist && bookingOn && !!orgId,
  });
  // ...
    skillGaps: bookingOn ? (skillGaps.data?.length ?? 0) : 0,
```

Note: `skillGaps.data` is `undefined` while loading, which yields `0` and a momentarily-green step. That matches the existing treatment of `skillsDone` and is acceptable because the step does not block; do not add it to `isLoading`, which would delay the whole board.

- [ ] **Step 10: Run the suite**

Run: `npx vitest run src/lib/getRunning src/hooks/useGetRunningV3.test.tsx src/data/skills.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/data/skills.ts src/data/skills.test.ts src/lib/getRunning/steps.ts src/lib/getRunning/steps.test.ts src/hooks/useGetRunningV3.ts
git commit -m "skills step checks artist eligibility instead of catalog size"
```

---

## Phase B — Steps that can clear their own block

> Tasks 4 and 5 need visual approval before implementation.

### Task 4: The cities step resolves dates that have no city

Fixes finding 02. `CitiesStep` only resolves *imported* Airtable city strings. On the manual path `cityRows` is always empty, so the body shows "No cities to resolve yet" while the step is flagged "Blocks your first ask" and a real date has no city. Continue then calls `onDone`, which collapses the wizard without completing anything.

**Files:**
- Create: `src/components/getRunning/v3/steps/DatesMissingCityList.tsx`
- Create: `src/components/getRunning/v3/steps/DatesMissingCityList.test.tsx`
- Modify: `src/components/getRunning/v3/steps/CitiesStep.tsx:149-186`
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`
- Test: `src/components/getRunning/v3/steps/CitiesStep.test.tsx`

**Interfaces:**
- Consumes: `BookingSetupStatus.hasAnyDates` (Task 1).
- Produces: `DatesMissingCityList` with props `{ orgId: string | null; canEdit: boolean }`, self-fetching via `useShowDates`/`useAllCities`, writing through the existing `updateShowDate` mutation.

- [ ] **Step 1: Write the failing test**

In `src/components/getRunning/v3/steps/CitiesStep.test.tsx`:

```ts
it("lists dates that have no city instead of claiming there is nothing to resolve", async () => {
  seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
  renderStep();
  expect(await screen.findByText(/stadthalle/i)).toBeInTheDocument();
  expect(screen.queryByText(/no cities to resolve yet/i)).not.toBeInTheDocument();
});

it("keeps Continue disabled while a date still has no city", async () => {
  seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
  renderStep();
  expect(await screen.findByRole("button", { name: /continue/i })).toBeDisabled();
});

it("shows a no-dates state, not a resolved state, when the org has no dates", async () => {
  seedDatesWithoutCity([]);
  seedDateCount(0);
  renderStep();
  expect(await screen.findByText(/no dates yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/getRunning/v3/steps/CitiesStep.test.tsx`
Expected: FAIL, the empty state still renders.

- [ ] **Step 3: Build `DatesMissingCityList`**

A table of dates lacking a city: date (via `formatDateDMY`), production, venue, and a city `Select` per row fed by `useAllCities`. Selecting writes through the existing show-date update mutation and invalidates `["show-dates"]`. Disabled entirely when `canEdit` is false. Include a "Manage cities in Settings" link to `${ROUTES.SETTINGS}?tab=casts-coverage` for creating a city that does not exist yet.

- [ ] **Step 4: Rewire `CitiesStep`'s branches**

Replace the single `isEmpty` branch with three, in order:
1. `!hasAnyDates` → "No dates yet" plus a link into the productions step (`?step=productions`).
2. `datesWithoutCity > 0` → `<DatesMissingCityList />`.
3. imported `cityRows.length > 0` → the existing `CatalogTab`.
4. otherwise → the existing resolved/empty note.

Change `canContinue` so the manual path also requires `datesWithoutCity === 0 && hasAnyDates`, not just resolved import rows.

- [ ] **Step 5: Add i18n keys (EN and DE)**

`body.cities.noDates`, `body.cities.noDatesLink`, `body.cities.missingHeading`, `body.cities.missingSub`, `body.cities.assignCity`. No dashes, Du-form in German.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/getRunning/v3/steps src/i18n`
Expected: PASS including `keyParity` and `copyLint`.

- [ ] **Step 7: Commit**

```bash
git add src/components/getRunning/v3/steps/DatesMissingCityList.tsx src/components/getRunning/v3/steps/DatesMissingCityList.test.tsx src/components/getRunning/v3/steps/CitiesStep.tsx src/components/getRunning/v3/steps/CitiesStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "cities step resolves dates that have no city"
```

---

### Task 5: The skills step assigns skills to artists

The same dead-end shape as Task 4: `SkillsStep` mounts `SkillsTab`, which manages the org catalog, while the step is about artists holding skills. With Task 3 the step now goes red on a real gap, so it must offer the fix.

**Files:**
- Create: `src/components/getRunning/v3/steps/ArtistSkillAssignList.tsx` + test
- Modify: `src/components/getRunning/v3/steps/SkillsStep.tsx:40-50`
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`

**Interfaces:**
- Consumes: `fetchSkillEligibilityGaps` / `SkillGap` (Task 3).
- Produces: `ArtistSkillAssignList` with props `{ orgId: string | null; canEdit: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
it("names the skills a part requires that nobody holds", async () => {
  seedGaps([{ skillId: "sk-1", name: "Lead Vocals" }]);
  renderStep();
  expect(await screen.findByText(/lead vocals/i)).toBeInTheDocument();
});

it("assigns a skill to an artist from inside the step", async () => {
  seedGaps([{ skillId: "sk-1", name: "Lead Vocals" }]);
  seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
  renderStep();
  fireEvent.click(await screen.findByRole("button", { name: /lead vocals/i }));
  await waitFor(() => expect(addArtistSkill).toHaveBeenCalledWith(expect.anything(), { artistId: "a1", skillId: "sk-1", orgId: "org-1" }));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/getRunning/v3/steps/SkillsStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Build the list**

Rows are active artists; each row carries a `SkillPicker` of the org catalog bound to that artist's skills, toggling through the existing artist-skill add/remove data functions. Above the list, render any `SkillGap` as a `StatusPill tone="risk"` naming the unheld skill, so the blocking reason is visible.

- [ ] **Step 4: Mount it in `SkillsStep`** above the existing `SkillsTab`, keeping the catalog manager available below.

- [ ] **Step 5: Add i18n keys (EN and DE)** and run `npx vitest run src/components/getRunning/v3/steps src/i18n`.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/ArtistSkillAssignList.tsx src/components/getRunning/v3/steps/ArtistSkillAssignList.test.tsx src/components/getRunning/v3/steps/SkillsStep.tsx src/components/getRunning/v3/steps/SkillsStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "skills step assigns skills to artists inline"
```

---

## Phase C — Create and require a skill while writing a casting breakdown

> Task 6 needs visual approval before implementation. The owner supplied a reference: a rounded chip with a leading check and the skill name, in the accent tint, for a selected skill.

### Task 6: `SkillPicker` can create a skill inline

The requested behaviour is half-built already: `CastingBreakdownFields.tsx:141-147` gives every part a `SkillPicker` bound to `row.skillIds`, so marking an existing skill required on a part works today. Two things block the flow the owner described. `SkillPicker` short-circuits to a plain paragraph when `skills.length === 0` (`"No skills yet. Add skills on artist profiles first."`), so a producer with an empty catalog has no way forward; and there is no way to add a skill that does not exist yet without leaving for Settings.

**Files:**
- Modify: `src/components/skills/SkillPicker.tsx`
- Modify: `src/components/skills/SkillPicker.test.tsx`
- Modify: `src/i18n/locales/{en,de}/productions.json`

**Interfaces:**
- Produces: `SkillPickerProps` gains two optional fields, so the three existing call sites (`RequiredSkillsSection.tsx:101`, `NextOfferHero.tsx:174`, `CastingBreakdownFields.tsx:141`) keep compiling:

```ts
  /** When set, renders a "New skill" affordance that creates a skill and immediately
   *  selects it. Must resolve to the created skill so the caller can select it by id
   *  without waiting for the ['skills'] invalidation to refetch. */
  onCreate?: (name: string) => Promise<{ id: string; name: string }>;
  /** Gate for the create affordance; distinct from `disabled`, which gates selection.
   *  Creation needs `manage_skills`, selection needs the caller's own capability. */
  canCreate?: boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("renders a create affordance instead of dead text when the catalog is empty", () => {
  render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={vi.fn()} canCreate emptyHint="none yet" />);
  expect(screen.getByRole("button", { name: /new skill/i })).toBeInTheDocument();
});

it("keeps the plain hint when creation is not allowed", () => {
  render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} emptyHint="none yet" />);
  expect(screen.getByText("none yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /new skill/i })).toBeNull();
});

it("selects the newly created skill without waiting for a refetch", async () => {
  const onCreate = vi.fn().mockResolvedValue({ id: "sk-9", name: "Lead Vocals" });
  const onToggle = vi.fn();
  render(<SkillPicker skills={[]} selectedIds={[]} onToggle={onToggle} onCreate={onCreate} canCreate />);
  fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lead Vocals" } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() => expect(onToggle).toHaveBeenCalledWith("sk-9"));
});

it("marks a selected skill with a check", () => {
  render(<SkillPicker skills={[{ id: "sk-1", name: "Piano" }]} selectedIds={["sk-1"]} onToggle={vi.fn()} />);
  expect(screen.getByRole("button", { name: /piano/i })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("skill-chip-check")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/skills/SkillPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Keep the existing chip markup and selected styling; add a `<Check>` (lucide, `h-3 w-3`, `data-testid="skill-chip-check"`) before the label when selected, matching the owner's reference. Replace the `skills.length === 0` short-circuit so the create affordance still renders. The create affordance is a chip-shaped button that swaps into a small inline form (text input plus submit); on submit it trims, calls `onCreate`, and on resolve calls `onToggle(created.id)`. Guard against an empty trimmed name and against double submit while pending.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/components/skills/SkillPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/skills/SkillPicker.tsx src/components/skills/SkillPicker.test.tsx
git commit -m "skill picker can create and select a skill inline"
```

---

### Task 7: Wire inline creation into the casting breakdown

**Files:**
- Modify: `src/components/catalog/CastingBreakdownFields.tsx:16-34`, `:141-147`
- Modify: `src/components/catalog/ShowFormDialog.tsx:63`, `:201-206`
- Modify: `src/components/getRunning/v3/steps/PartsEditorSheet.tsx:96-101`
- Modify: `src/i18n/locales/{en,de}/productions.json` (`form.skillsEmptyHint`)
- Test: `src/components/catalog/CastingBreakdownFields.test.tsx`, `src/components/catalog/ShowFormDialog.test.tsx`

**Interfaces:**
- Consumes: `SkillPickerProps.onCreate` / `canCreate` (Task 6).
- Produces: `CastingBreakdownFieldsProps` gains `onCreateSkill?: (name: string) => Promise<SkillOption>` and `canCreateSkill?: boolean`. Both optional so neither consumer breaks.

- [ ] **Step 1: Write the failing test**

In `CastingBreakdownFields.test.tsx`:

```ts
it("adds a newly created skill to the part's required skills", async () => {
  const onChange = vi.fn();
  const onCreateSkill = vi.fn().mockResolvedValue({ id: "sk-9", name: "Lead Vocals" });
  renderWithProviders(
    <CastingBreakdownFields
      value={[{ id: "r1", name: "Lead", count: 1, kind: "main", skillIds: [] }]}
      onChange={onChange}
      skills={[]}
      onCreateSkill={onCreateSkill}
      canCreateSkill
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
  fireEvent.change(screen.getByRole("textbox", { name: /skill name/i }), { target: { value: "Lead Vocals" } });
  fireEvent.submit(screen.getByRole("textbox", { name: /skill name/i }).closest("form")!);
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ skillIds: ["sk-9"] })]),
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/catalog/CastingBreakdownFields.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Thread `onCreateSkill`/`canCreateSkill` into each row's `SkillPicker` as `onCreate`/`canCreate`. The picker already calls `onToggle(id)` on create, and `toggleRowSkill` already appends to `row.skillIds`, so no new state path is needed.

- [ ] **Step 4: Wire both consumers**

In `ShowFormDialog.tsx` and `PartsEditorSheet.tsx`, pass:

```tsx
  canCreateSkill={canManageSkills}
  onCreateSkill={(name) => createSkill.mutateAsync(name)}
```

with `const canManageSkills = useCan("manage_skills");` and `const createSkill = useCreateSkill();`. Note `manage_skills` is a different capability from the `edit_scheduling` that gates the editor, so it needs its own gate rather than inheriting `slotsDisabled`.

- [ ] **Step 5: Handle the archived-name collision**

`useSkills()` filters archived skills, so creating a name that collides with an archived skill hits the raw unique-index error. Catch the rejection in the picker's submit and surface `toast.error` with the existing `settingsSkills` collision copy rather than letting it escape. Add a test that a rejected `onCreate` leaves `skillIds` unchanged and does not throw.

- [ ] **Step 6: Update the empty-hint copy (EN and DE)**

`form.skillsEmptyHint` currently reads "No skills yet. Add skills on artist profiles first." Replace with copy that matches the new affordance, e.g. "No skills yet. Create the first one here." No dashes; Du-form in German.

- [ ] **Step 7: Run the suite**

Run: `npx vitest run src/components/catalog src/components/getRunning/v3/steps/PartsEditorSheet.test.tsx src/components/skills src/i18n`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/catalog src/components/getRunning/v3/steps/PartsEditorSheet.tsx src/i18n/locales/en/productions.json src/i18n/locales/de/productions.json
git commit -m "create and require a skill while writing a casting breakdown"
```

---

### Task 7b: Add cities while setting up a production

Owner amendment to finding 11: cities should be created where the producer is already thinking about them, not discovered as missing later. **Decision taken: org-level only, no schema change.** Cities stay a single org-wide catalog; the production dialog is simply the place you can add to it. Nothing is stored per production.

Because the data is org-wide, the copy must not imply otherwise. Do **not** label this "Where will this production tour?" — that promises a per-production memory this build does not have. Label it for what it is, and say the list is shared.

`CoveragePanel.tsx:248-252` currently creates a city with a bare inline `supabase.from("cities").insert(...)`, bypassing the data-access layer. Extract it so both callers share one function rather than duplicating the insert.

**Files:**
- Modify: `src/data/cities.ts` (add `createCity`), `src/data/cities.test.ts`
- Modify: `src/components/settings/castsCoverage/CoveragePanel.tsx:248-252`
- Create: `src/components/catalog/CityCatalogField.tsx` + `CityCatalogField.test.tsx`
- Modify: `src/components/catalog/ShowFormDialog.tsx` (mount below the casting breakdown)
- Modify: `src/i18n/locales/{en,de}/productions.json`

**Interfaces:**
- Consumes: the chip markup and inline-create interaction established in Task 6 (same classes, same submit behaviour). Do not extract a shared abstraction: the skill picker has selection state and this does not, and two near-neighbours are not yet a pattern.
- Produces: `createCity(client: SupabaseClient, args: { name: string; orgId: string }): Promise<{ id: string; name: string }>`
- Produces: `CityCatalogField` with props `{ orgId: string | null }`, self-fetching via `useCities`.

- [ ] **Step 1: Write the failing data test**

In `src/data/cities.test.ts`:

```ts
it("creates a city for the org and returns it", async () => {
  const client = createFakeSupabase({ cities: { data: { id: "c-9", name: "Bremen" }, error: null } });
  const city = await createCity(asSupabase(client), { name: "  Bremen  ", orgId: "org-1" });
  expect(city).toEqual({ id: "c-9", name: "Bremen" });
  expect(client.calls).toContainEqual({ table: "cities", method: "insert", args: [{ name: "Bremen", org_id: "org-1" }] });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/data/cities.test.ts`
Expected: FAIL, `createCity is not a function`.

- [ ] **Step 3: Implement `createCity`**

Append to `src/data/cities.ts`:

```ts
/** Add a city to the org's shared catalog. Cities are org-wide, not per production. */
export async function createCity(
  client: SupabaseClient,
  args: { name: string; orgId: string },
): Promise<{ id: string; name: string }> {
  const name = args.name.trim();
  if (!name) throw new Error("A city needs a name");
  const { data, error } = await client
    .from("cities")
    .insert({ name, org_id: args.orgId })
    .select("id, name")
    .single();
  if (error) throw error;
  return { id: data.id as string, name: data.name as string };
}
```

- [ ] **Step 4: Run it and watch it pass, then adopt it in Settings**

Run: `npx vitest run src/data/cities.test.ts`
Expected: PASS.

Replace the inline insert in `CoveragePanel.tsx:249-251` with `createCity(supabase, { name, orgId })`, keeping the existing `onSuccess` invalidation untouched. Run `npx vitest run src/components/settings/castsCoverage` and expect no change in behaviour.

- [ ] **Step 5: Write the failing component test**

In `src/components/catalog/CityCatalogField.test.tsx`:

```ts
it("lists the org's existing cities", async () => {
  renderField({ cities: [{ id: "c1", name: "Bremen" }, { id: "c2", name: "Hamburg" }] });
  expect(await screen.findByText("Bremen")).toBeInTheDocument();
  expect(screen.getByText("Hamburg")).toBeInTheDocument();
});

it("creates a city inline", async () => {
  renderField({ cities: [] });
  fireEvent.click(await screen.findByRole("button", { name: /new city/i }));
  fireEvent.change(screen.getByRole("textbox", { name: /city name/i }), { target: { value: "Leipzig" } });
  fireEvent.submit(screen.getByRole("textbox", { name: /city name/i }).closest("form")!);
  await waitFor(() => expect(createCity).toHaveBeenCalledWith(expect.anything(), { name: "Leipzig", orgId: "org-1" }));
});

it("hides the create affordance without manage_cities", async () => {
  vi.mocked(useCan).mockReturnValue(false);
  renderField({ cities: [] });
  expect(screen.queryByRole("button", { name: /new city/i })).toBeNull();
});
```

- [ ] **Step 6: Run and watch them fail, then implement**

Run: `npx vitest run src/components/catalog/CityCatalogField.test.tsx`
Expected: FAIL.

Render existing cities as **non-interactive** chips (they carry no per-production selection, so they must not look clickable: no `aria-pressed`, no hover affordance) plus a dashed "New city" chip that swaps into the same inline form as Task 6. Gate the create affordance on `useCan("manage_cities")`, which is the capability Settings uses, and is distinct from the `edit_scheduling` that gates the rest of the dialog.

- [ ] **Step 7: Mount it in `ShowFormDialog`**

Place it below the casting breakdown, as its own labelled section. Do not add it to `PartsEditorSheet`, which edits parts for an existing production and has no city concern.

- [ ] **Step 8: Add honest copy (EN and DE)**

`form.cities.heading` = "Cities you play", `form.cities.sub` = "Cities are shared across every production. Add one here so it is ready when you schedule a date.", `form.cities.new` = "New city", `form.cities.nameLabel` = "City name". No dashes; Du-form in German.

- [ ] **Step 9: Run and commit**

```bash
npx vitest run src/data/cities.test.ts src/components/catalog src/components/settings/castsCoverage src/i18n
git add src/data/cities.ts src/data/cities.test.ts src/components/settings/castsCoverage/CoveragePanel.tsx src/components/catalog/CityCatalogField.tsx src/components/catalog/CityCatalogField.test.tsx src/components/catalog/ShowFormDialog.tsx src/i18n/locales/en/productions.json src/i18n/locales/de/productions.json
git commit -m "add cities from the production dialog"
```

---

## Phase D — Primary actions that mean what they say

### Task 8: Letterhead cannot be confirmed empty

Fixes finding 05. `LetterheadStep` enables Confirm with every field blank, writes the blank payload, toasts success and calls `onDone`, while `letterheadDone` (`src/lib/hireOrders/setupStatus.ts:55`) requires a non-blank `legal_name`, so the step stays outstanding. The intro also claims the values were "pulled from your organization profile" when nothing is prefilled.

**Files:**
- Modify: `src/components/hireOrders/setup/LetterheadStep.tsx:84-86`
- Modify: `src/i18n/locales/{en,de}/hireOrdersPages.json:347`
- Test: `src/components/hireOrders/setup/LetterheadStep.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps Confirm disabled until the legal name is filled", async () => {
  renderStep({ legal_name: "" });
  expect(await screen.findByRole("button", { name: /confirm/i })).toBeDisabled();
});

it("enables Confirm once a legal name is present", async () => {
  renderStep({ legal_name: "Bootstrap Productions GmbH" });
  expect(await screen.findByRole("button", { name: /confirm/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/hireOrders/setup/LetterheadStep.test.tsx`
Expected: FAIL, the button is enabled.

- [ ] **Step 3: Implement**

Mirror `letterheadDone` exactly so the button cannot produce a no-op:

```tsx
  const canConfirm = form.legal_name.trim().length > 0;
  // ...
  <Button size="sm" disabled={!canConfirm || save.isPending || !orgId} onClick={() => save.mutate()}>
```

- [ ] **Step 4: Fix the intro copy (EN and DE)**

`letterheadStep.intro` becomes copy that does not claim a prefill, e.g. "Your name, address and registration line print at the top of every contract."

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/components/hireOrders src/i18n
git add src/components/hireOrders/setup/LetterheadStep.tsx src/components/hireOrders/setup/LetterheadStep.test.tsx src/i18n/locales/en/hireOrdersPages.json src/i18n/locales/de/hireOrdersPages.json
git commit -m "letterhead cannot be confirmed empty"
```

---

### Task 9: Consistent advance and a phase-complete handoff

Fixes findings 06 and 07. Steps that save through an explicit action advance; steps that complete implicitly from data leave the viewer parked on a finished step. Completing a phase's last step collapses the wizard with no confirmation.

**Files:**
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx:249-260` (`handleStepDone`)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`
- Test: `src/components/getRunning/v3/GetRunningBoardV3.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

```ts
it("advances to the next outstanding step when a step completes from data alone", async () => {
  // model where `artists` flips done on refetch while the wizard sits on it
  expect(await screen.findByText(/set skills on your artists/i)).toBeInTheDocument();
});

it("confirms the finished phase and names the next one instead of closing silently", () => {
  // complete the last outstanding step of get_dates
  expect(screen.getByText(/get dates in is done/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/getRunning/v3/GetRunningBoardV3.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the advance**

Add an effect that, when the open step becomes `done` and a later visible step in the same phase is not done, moves `selectedStep` forward. Guard it with a ref keyed on the step key so a viewer who deliberately clicks back to a finished step is not bounced forward again.

- [ ] **Step 4: Implement the handoff**

In `handleStepDone`, when no outstanding step remains in the phase, replace the bare `handleCollapse()` with a `toast.success` naming the finished phase and the next one, then collapse. Reuse `sonner`, matching the codebase's side-effect convention.

- [ ] **Step 5: Add i18n keys (EN and DE)**: `wizard.phaseDone`, `wizard.phaseDoneNext`.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/components/getRunning/v3 src/i18n
git add src/components/getRunning/v3/GetRunningBoardV3.tsx src/components/getRunning/v3/GetRunningBoardV3.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "advance consistently and confirm a finished phase"
```

---

## Phase E — Copy and affordances

### Task 10: Warn on a show date in the past

Fixes finding 08. `ShowDateFormDialog.tsx:253` renders `<Calendar mode="single" weekStartsOn={1} …>` with no `disabled`, so all 42 cells are selectable and a date can be created in the past with no warning.

A hard block is rejected deliberately: back-filling a historical date for records is legitimate, and the Airtable sync creates past dates on a path that never touches this dialog. A non-blocking inline warning stops the typo without removing the capability.

**Files:**
- Modify: `src/components/shows/ShowDateFormDialog.tsx:246-256`
- Modify: `src/i18n/locales/{en,de}/showsDetail.json`
- Test: `src/components/shows/ShowDateFormDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("warns when the chosen date is in the past", async () => {
  renderDialog({ today: "2026-08-24" });
  pickDate("2026-07-28");
  expect(await screen.findByText(/this date is in the past/i)).toBeInTheDocument();
});

it("shows no warning for a future date", async () => {
  renderDialog({ today: "2026-08-24" });
  pickDate("2026-09-04");
  expect(screen.queryByText(/this date is in the past/i)).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement**

Compare the selected date against today with `parseDateOnly`/`toDateKey` from `src/lib/dates.ts` (timezone-safe; do not use `new Date()` string comparison). Render the warning as a `text-xs text-warning` line under the picker. Do not disable submit.

- [ ] **Step 3: Add i18n keys (EN and DE)**, run `npx vitest run src/components/shows src/i18n`, commit.

---

### Task 11: Mark the page minis as examples

Fixes finding 09. The explainer panels on Settings and Dates render invented tiers, people and audit entries ("Tier 1: Berlin Principal", "Sam Producer changed…") on an org that has none. These are the documented page-mini illustrations (`src/components/minis/illustrations/`), so the fix is to label them, not to remove them.

**Files:**
- Modify: `src/components/minis/PageMini.tsx:47-55`
- Modify: `src/i18n/locales/{en,de}/common.json`
- Test: `src/components/minis/PageMini.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("labels the illustration as an example", () => {
  renderMini("settings");
  expect(screen.getByText(/example/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, fail, implement**

Add a `<StatusPill tone="neutral">` reading "Example" into the mini header row, beside the existing eyebrow. Keep it inside the `aria-label`led section so screen readers reach it before the fabricated names.

- [ ] **Step 3: Add the `common:mini.example` key (EN and DE)**, run `npx vitest run src/components/minis src/i18n`, commit.

---

### Task 12: Copy that matches what the control does

Fixes findings 10, 11 and 12. Four independent copy edits, one commit.

**Files:**
- `src/i18n/locales/{en,de}/getRunningV3.json:292` — the countersignature guide says "Decide who signs on behalf of the org", while the controls choose how the *artist* signs. Reword to match the control.
- `src/i18n/locales/{en,de}/showsDetail.json:166` — `noRestrictions` reads "Anyone can be asked." on a date with zero eligible artists. Make it state the eligible count, and say nobody is eligible yet when it is zero.
- `src/components/shows/ShowDateFormDialog.tsx:285` — the City select offers no way to add a city and no pointer; add a hint linking to `${ROUTES.SETTINGS}?tab=casts-coverage` when the city list is empty (finding 11).
- `src/components/getRunning/v3/WizardShell.tsx:100-102` — the counter jumps from "Step 1 of 5" to "Step 3 of 3" when a source choice hides two steps (finding 10). Keep the number honest but stop it reading as a skip: render the counter from the visible list only after the step list settles, and add an `aria-live="polite"` so the change is announced rather than silent.

- [ ] **Step 1: Write a test per copy change** asserting the rendered string, in the existing test file for each surface.
- [ ] **Step 2: Run, fail, implement, run.**
- [ ] **Step 3: Full gate and commit**

```bash
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
git add -A
git commit -m "copy matches what each control actually does"
```

---

## Final verification

- [ ] `npm run verify:fast` (lint, typecheck, build, unit + coverage, Deno)
- [ ] `PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test dark-mode-contrast --config=e2e/playwright.config.ts`
- [ ] Re-run the audit walkthrough by hand on an emptied org: wipe, then confirm the board reports **0 of 14** rather than 2 of 14, that adding the first date never moves the counter backwards, and that reaching 14 of 14 coincides with a date that can actually be asked.
- [ ] Update `public/changelog.md` with a user-facing entry, then regenerate: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
- [ ] Help-center impact: the cities and skills steps change what an admin would ask. Update `src/lib/help/items.ts` (EN and DE) in the same PR, or state "No help center impact." in the description.

---

## Self-Review

**1. Spec coverage.** Every finding maps to a task: 01 → Tasks 1, 2, 3; 02 → Task 4; 03 → Task 1; 04 → Task 1; 05 → Task 8; 06 → Task 9; 07 → Task 9; 08 → Task 10; 09 → Task 11; 10 → Task 12; 11 → Tasks 7b and 12; 12 → Task 12. The owner's feature request maps to Tasks 6 and 7, and the owner's cities amendment to Task 7b. No finding is unaddressed.

**Owner decisions recorded.** Skills predicate: functional eligibility (Task 3). Past dates: warn, do not block (Task 10). Cities: org-level only, no schema change (Task 7b) — the copy carries the honesty burden that the missing per-production storage creates.

**2. Placeholder scan.** Tasks 1, 2, 3, 6, 7 and 8 carry real test and implementation code. Tasks 4, 5, 9, 10, 11 and 12 describe UI whose visual design is not yet approved, so they specify behaviour, exact files, exact keys and exact assertions but stop short of final markup. That is deliberate and is flagged by the visual approval gate; an executor must not start Tasks 4, 5 or 6 before the mockups are signed off. Tasks 9 to 12 give assertions and file targets but leave small markup choices open, which is acceptable for copy-level edits.

**3. Type consistency.** `dateCount` (input, `number | null`) and `hasAnyDates` (output, `boolean`) are distinct and used consistently across Tasks 1, 4. `nonEmptyCastIds: string[]` is added to `LadderCoverageInputs` in Task 2 and must be added to every existing literal of that type in tests. `skillGaps: number` on `GetRunningInputV3` replaces `skillsDone: boolean`; `SkillGap { skillId, name }` is the data shape and is used by Tasks 3 and 5 under the same name. `onCreate`/`canCreate` on `SkillPickerProps` (Task 6) are consumed as `onCreateSkill`/`canCreateSkill` on `CastingBreakdownFieldsProps` (Task 7); the rename is intentional, since the picker's prop is generic and the field group's is domain-specific, and both are spelled out above.

**Two risks worth naming.**
- Task 3 changes what "skills done" means. An org that has skills in its catalog, none required by any part, and none assigned to artists will now read **done** where it previously also read done. The behaviour only tightens once a part requires a skill. If the owner wants the stricter "every artist should have skills" reading instead, say so before Task 3, since it changes the predicate and would block skill-free orgs.
- Task 1 makes two steps go red on a blank org, so a first-run board will read **0 of 14** rather than 2 of 14. That is the intended correction, but it is a visible change to the first screen a new customer sees.
