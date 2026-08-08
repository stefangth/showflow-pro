# Fresh-org module picker + booking-flow "off" state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super-admin choose modules when provisioning an org, land a booking-enabled org in an explicit "off" state instead of silently running classic, and make the dashboard onboarding read an honest 0-of-N on a fresh org.

**Architecture:** Add an `active` master switch to the `booking_flow` JSONB policy (defaults `true`, so every existing/legacy org is unchanged). Surface it as an "Off" preset tile. Gate runtime automation and the onboarding "flow chosen" signal on `active`. Provisioning seeds a booking-enabled org into the off state and seeds `org_entitlements` from an explicit picker choice. Separately, fix the onboarding steps that read vacuously-done over empty collections.

**Tech Stack:** React 18 + TS, Vitest + jsdom + @testing-library/react, Deno edge functions (DI + `makeFakeDeps`), Supabase (JSONB `app_settings`, `org_entitlements`).

## Global Constraints

- **No em/en dashes in any user-facing copy** (UI strings, banners, changelog). Use period/comma/colon.
- **Semantic tokens only** in components (`bg-muted-foreground`, `text-foreground`, …); never hardcode colors.
- **`src/lib/bookingFlow.ts` and `supabase/functions/_shared/bookingFlow.ts` are hand-mirrored** (NOT in `mirrors.manifest.json`). Any change to types / defaults / normalize lands in BOTH files in the same task. There is no generator guard.
- **Field name is `active`, never `enabled`** — `enabled` already means the entitlement (super-admin licensing). `active` is the org-admin in-module on/off.
- **`any` is banned** (CI `--max-warnings 0`). Derive from `Database` types; single `as unknown as` cast at query boundaries only.
- **Never change `FEATURE_REGISTRY.defaultEnabled`** — it stays the fallback for legacy orgs with no `org_entitlements` row. The picker's "off by default" is a UI default only.
- **Changelog rule:** the module picker is a platform/super-admin action → it MUST NOT appear in `public/changelog.md`. Only the org-facing surface (Off toggle, accurate checklist) is changelog-worthy.
- Type-check after edits: `npx tsc -p tsconfig.app.json --noEmit` (src) and `deno check --node-modules-dir=none supabase/functions/<fn>/index.ts` (any edge fn touched).

---

## Parallelization Map

```
Wave 1 (no deps):     Task 1 (model foundation)        Task 6 (provisionOrg data fn)
                            │                                    │
Wave 2 (after T1):    ┌─────┼──────────┬───────────┐            ▼
                      ▼     ▼          ▼           ▼        Task 7 (NewOrgDialog picker)
                   Task 2  Task 3    Task 4      Task 5      (after T6)
                  (Settings)(Runtime)(Onboarding)(Provision edge)
                            │
Wave 3 (last):        Task 8 (changelog + version bump)  — after all feature tasks
```

**Disjoint file sets** (so Wave-2 tasks + Task 6/7 can run as parallel subagents or worktrees):

| Task | Files it modifies |
|---|---|
| 1 | `src/lib/bookingFlow.ts`(+`.test.ts`), `supabase/functions/_shared/bookingFlow.ts` |
| 2 | `src/components/settings/bookingFlow/FlowPresets.tsx`, `BookingFlowTab.tsx`(+`.test.tsx`) |
| 3 | `supabase/functions/airtable-poll/index.ts`(+`.di.test.ts`), `supabase/functions/expire-offers/index.ts`(+`.di.test.ts`), `src/data/systemMap.ts`, `docs/system-map.md` |
| 4 | `src/lib/bookings/setupStatus.ts`(+`.test.ts`), `src/hooks/useBookingSetup.ts` |
| 5 | `supabase/functions/provision-org/index.ts`(+`.di.test.ts`) |
| 6 | `src/data/platform.ts` |
| 7 | `src/components/platform/NewOrgDialog.tsx`(+`.test.tsx`) |

Task 5 (edge provision) depends on Task 1 only for the `normalizeBookingFlow` off-seed. Tasks 6/7 are independent of Task 1 (they only pass an entitlements map). Task 8 is sequential and last.

---

## Task 1: Booking-flow `active` master switch (model foundation)

**Files:**
- Modify: `src/lib/bookingFlow.ts`
- Modify: `supabase/functions/_shared/bookingFlow.ts` (hand mirror — same task)
- Test: `src/lib/bookingFlow.test.ts`

**Interfaces:**
- Produces: `BookingFlow.active: boolean`; `PresetName = "classic" | "fasttrack" | "direct" | "off"`; `applyPreset(flow, "off") ⇒ {...flow, active:false}` and `applyPreset(flow, real) ⇒ {...flow, ...preset, active:true}`; `matchPreset(flow) ⇒ "off"` iff `!flow.active`, else the field-match. `normalizeBookingFlow` reads `active` (default `true`).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/bookingFlow.test.ts` (ensure `normalizeBookingFlow`, `matchPreset`, `applyPreset` are imported from `./bookingFlow` — add any missing name to the existing import):

```ts
describe("active master switch", () => {
  it("defaults active=true when the key is absent (legacy/no-row parity)", () => {
    expect(normalizeBookingFlow(null).active).toBe(true);
    expect(normalizeBookingFlow({}).active).toBe(true);
  });
  it("round-trips active=false", () => {
    expect(normalizeBookingFlow({ active: false }).active).toBe(false);
  });
  it("matchPreset returns 'off' iff inactive, regardless of fields", () => {
    expect(matchPreset(normalizeBookingFlow({ active: false }))).toBe("off");
    expect(matchPreset(normalizeBookingFlow(null))).toBe("classic"); // active + classic fields
  });
  it("applyPreset('off') deactivates but preserves fields; a real preset reactivates", () => {
    const base = normalizeBookingFlow(null);
    const off = applyPreset(base, "off");
    expect(off.active).toBe(false);
    expect(off.auto_open_tier1).toBe(base.auto_open_tier1); // fields preserved
    const back = applyPreset(off, "fasttrack");
    expect(back.active).toBe(true);
    expect(back.auto_escalate).toBe(true); // fasttrack field applied
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: FAIL (`active` missing / `applyPreset('off')` type error).

- [ ] **Step 3: Edit `src/lib/bookingFlow.ts`**

In `interface BookingFlow`, add after `understudy_promotion: boolean;`:
```ts
  /** Master switch: false = the whole flow is paused (the "off" preset). Defaults true. */
  active: boolean;
```
In `BOOKING_FLOW_DEFAULTS`, add `active: true,` (before `reference_field`).
Change the `FlowFields` alias and the presets record type so `active` is NOT a preset field:
```ts
type FlowFields = Omit<BookingFlow, "reference_field" | "active">;

export type PresetName = "classic" | "fasttrack" | "direct" | "off";

export const BOOKING_FLOW_PRESETS: Record<Exclude<PresetName, "off">, FlowFields> = {
```
(the three existing preset literals are unchanged.)
In `normalizeBookingFlow`, add the `active` read (it is not in the `bool` loop) and include it in the returned object:
```ts
  const active = typeof raw.active === "boolean" ? raw.active : BOOKING_FLOW_DEFAULTS.active;
```
and add `active,` inside the `const flow: BookingFlow = { … }` literal (e.g. right before `reference_field,`). Keep the existing `if (!flow.artist_acceptance) flow.producer_confirmation = true;` line.
Replace `applyPreset` and `matchPreset`:
```ts
export function applyPreset(flow: BookingFlow, preset: PresetName): BookingFlow {
  if (preset === "off") return { ...flow, active: false };
  return { ...flow, ...BOOKING_FLOW_PRESETS[preset], active: true };
}

export function matchPreset(flow: BookingFlow): PresetName | "custom" {
  if (!flow.active) return "off";
  for (const name of Object.keys(BOOKING_FLOW_PRESETS) as Exclude<PresetName, "off">[]) {
    const preset = BOOKING_FLOW_PRESETS[name];
    if (FLOW_FIELD_KEYS.every((key) => flow[key] === preset[key])) return name;
  }
  return "custom";
}
```
(`FLOW_FIELD_KEYS = Object.keys(BOOKING_FLOW_PRESETS.classic)` is unchanged — 9 fields, no `active`.)

- [ ] **Step 4: Mirror into `supabase/functions/_shared/bookingFlow.ts`**

Apply the SAME three changes (interface `active`, `BOOKING_FLOW_DEFAULTS.active: true`, `FlowFields = Omit<BookingFlow, "reference_field" | "active">`, and the `const active = …` + `active,` line in `normalizeBookingFlow`). The edge file has NO presets/applyPreset/matchPreset — do not add them.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: PASS.
Run: `npx tsc -p tsconfig.app.json --noEmit` and `deno check --node-modules-dir=none supabase/functions/_shared/bookingFlow.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bookingFlow.ts src/lib/bookingFlow.test.ts supabase/functions/_shared/bookingFlow.ts
git commit -m "add active master switch to booking flow model"
```

---

## Task 2: Settings — "Off" preset tile + off banner  *(Wave 2, depends on Task 1)*

**Files:**
- Modify: `src/components/settings/bookingFlow/FlowPresets.tsx`
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.tsx`
- Test: `src/components/settings/bookingFlow/BookingFlowTab.test.tsx`

**Interfaces:**
- Consumes: `matchPreset`, `applyPreset`, `PresetName` (Task 1). `FlowPresets` `onSelect: (p: PresetName) => void` now also emits `"off"`.

- [ ] **Step 1: Write the failing test**

Append to `BookingFlowTab.test.tsx` (follow the file's existing render helper / `get`/`set` harness):

```tsx
it("shows the Off state: banner + Off tile pressed when the flow is inactive", () => {
  // render the tab with get('booking_flow') returning an inactive policy
  renderTab({ booking_flow: { active: false } }); // adapt to the file's existing render helper
  expect(screen.getByText(/booking flow is off/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Off$/ })).toHaveAttribute("aria-pressed", "true");
});

it("selecting a real preset from Off turns the flow active", async () => {
  const set = vi.fn();
  renderTab({ booking_flow: { active: false } }, { set });
  await userEvent.click(screen.getByRole("button", { name: /Classic/i }));
  expect(set).toHaveBeenCalledWith("booking_flow", expect.objectContaining({ active: true }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
Expected: FAIL (no Off tile / no banner).

- [ ] **Step 3: Edit `FlowPresets.tsx`**

Add an `off` entry to `PRESET_META`:
```ts
  off: { name: "Off", desc: "Booking flow paused. No offers, reminders or confirmations run.", dotClass: "bg-muted-foreground" },
```
Build the render list to include `off` after the three real presets (BOOKING_FLOW_PRESETS no longer has an `off` key):
```ts
  const presets: PresetName[] = [
    ...(Object.keys(BOOKING_FLOW_PRESETS) as Exclude<PresetName, "off">[]),
    "off",
  ];
```
Change the grid to fit four buttons + the Custom tile on one desktop row: `md:grid-cols-4` → `md:grid-cols-5` on the wrapper `div`. The existing `.map` over `presets` renders the Off button unchanged (it already uses `PRESET_META[p]`, `aria-pressed={active === p}`, `onClick={() => onSelect(p)}`).

- [ ] **Step 4: Edit `BookingFlowTab.tsx`**

After `const flow = normalizeBookingFlow(...)`, derive the off state (presets stay clickable so the admin can turn it on; only the editors below disable):
```ts
  const preset = matchPreset(flow);
  const isOff = !stepsDisabled && preset === "off";
```
Import `matchPreset` (already imports `applyPreset`, `normalizeBookingFlow`). Add the banner just below the `locked` `<Alert>` block:
```tsx
      {isOff && (
        <Alert>
          <AlertTitle>Booking flow is off</AlertTitle>
          <AlertDescription>
            No offers, reminders or confirmations run for this workspace. Pick a flow above to turn it on.
          </AlertDescription>
        </Alert>
      )}
```
Leave `<FlowPresets … disabled={stepsDisabled} />` as-is (still enabled in the off state). Disable the editors below in the off state by passing `disabled={stepsDisabled || isOff}` to both `<FlowTimeline />` and `<FlowRail locked={stepsDisabled || isOff} />`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
Expected: PASS.
Run: `npx tsc -p tsconfig.app.json --noEmit` → clean. Run `npm run lint -- src/components/settings/bookingFlow` → 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/bookingFlow/FlowPresets.tsx src/components/settings/bookingFlow/BookingFlowTab.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx
git commit -m "add Off preset + off-state banner to booking flow settings"
```

---

## Task 3: Runtime — gate automation on `active` + update system map  *(Wave 2, depends on Task 1)*

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts` (auto-open condition, ~`:430`)
- Modify: `supabase/functions/expire-offers/index.ts` (auto-escalation, ~`:321`)
- Modify: `src/data/systemMap.ts` (lines ~213, ~280/284), `docs/system-map.md` (line ~10)
- Test: `supabase/functions/airtable-poll/index.di.test.ts`, `supabase/functions/expire-offers/index.di.test.ts`

**Scope note:** only the two automation paths that OPEN a tier (`airtable-poll` tier-1 auto-open, `expire-offers` auto-escalation) gain the `active` gate. In-flight offer expiry/reminders and manual `open-offer-tier` are intentionally NOT gated on `active` (an admin switching Off lets existing offers resolve; a producer can still act deliberately). `active` = "automation opens tiers on its own."

**Interfaces:**
- Consumes: `flow.active` from `resolveBookingFlow` (Task 1 edge mirror).

- [ ] **Step 1: Write the failing tests**

In `airtable-poll/index.di.test.ts`, add a test modeled on the existing auto-open test but with an inactive flow (seed the org's `booking_flow` app_setting to `{ active: false }` via the fake, mirroring how other tests seed `resolveBookingFlow`) and assert NO `open-offer-tier` invoke occurs. In `expire-offers/index.di.test.ts`, add a test with `{ auto_escalate: true, active: false }` asserting no tier escalation invoke.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all supabase/functions/airtable-poll/ supabase/functions/expire-offers/`
Expected: FAIL (auto-open/escalation still fires while inactive).

- [ ] **Step 3: Add the `active` gate**

`airtable-poll/index.ts` — the condition currently reads:
```ts
if (flow.auto_open_tier1 && flow.artist_acceptance && await checkFeature(admin, orgId, "booking_flow")) {
```
Insert `flow.active &&` first (in-memory, before the entitlement round-trip):
```ts
if (flow.active && flow.auto_open_tier1 && flow.artist_acceptance && await checkFeature(admin, orgId, "booking_flow")) {
```
`expire-offers/index.ts` — the condition currently reads:
```ts
if (flow.auto_escalate && activeOrgIds.has(orgId) && row.tier !== 99) {
```
Change to:
```ts
if (flow.active && flow.auto_escalate && activeOrgIds.has(orgId) && row.tier !== 99) {
```

- [ ] **Step 4: Update the system map (same PR as the automation change)**

In `src/data/systemMap.ts` line ~213, the airtable-poll Effects string reads `… gated on the booking_flow entitlement ∧ auto_open_tier1 ∧ artist_acceptance …` — insert `∧ booking flow active (not switched off)` into that conjunction. Do the same for the expire-offers auto-escalation Gate (~line 280) where it describes the escalation path. In `docs/system-map.md` line ~10, the sentence `… when the org is entitled to the booking_flow module and its booking_flow.auto_open_tier1 and artist_acceptance are both on …` → add `, the flow is active (not switched off),`. Grep to locate exact strings: `grep -n "auto_open_tier1 ∧ artist_acceptance\|auto_open_tier1 and artist_acceptance" src/data/systemMap.ts docs/system-map.md`.

- [ ] **Step 5: Run tests + checks**

Run: `deno test --allow-all supabase/functions/airtable-poll/ supabase/functions/expire-offers/` → PASS.
Run: `deno check --node-modules-dir=none supabase/functions/airtable-poll/index.ts supabase/functions/expire-offers/index.ts` → clean.
Run: `npx tsc -p tsconfig.app.json --noEmit` (systemMap.ts is TS) → clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/expire-offers/index.ts supabase/functions/airtable-poll/index.di.test.ts supabase/functions/expire-offers/index.di.test.ts src/data/systemMap.ts docs/system-map.md
git commit -m "gate tier auto-open and auto-escalation on booking flow active switch"
```

---

## Task 4: Onboarding — honest flow-chosen + no vacuous-done  *(Wave 2, depends on Task 1)*

**Files:**
- Modify: `src/lib/bookings/setupStatus.ts` (`computeBookingSetupStatus`)
- Modify: `src/hooks/useBookingSetup.ts` (compute `flowChosen` from `active`)
- Test: `src/lib/bookings/setupStatus.test.ts`

**Interfaces:**
- Consumes: `input.coverage.futurePairs` (already on `LadderCoverageInputs`), `fetchBookingFlow` from `@/data/settings` (returns the normalized `BookingFlow` with `active`).
- Produces: `computeBookingSetupStatus` returns slots/ladder/eligibility `done:false` when there are no shows / no future dates.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/bookings/setupStatus.test.ts`:

```ts
it("a fresh empty org reads 0 of 5 (no shows, no dates)", () => {
  const status = computeBookingSetupStatus({
    flowChosen: false,
    shows: [],                                   // seeded catalog has no shows
    timingChosen: false,
    coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
  });
  expect(status.doneCount).toBe(0);
  expect(status.steps.find((s) => s.key === "slots")!.done).toBe(false);
  expect(status.steps.find((s) => s.key === "ladder")!.done).toBe(false);
  expect(status.steps.find((s) => s.key === "eligibility")!.done).toBe(false);
});

it("slots/ladder/eligibility flip to done once real data covers them", () => {
  const status = computeBookingSetupStatus({
    flowChosen: true,
    shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
    timingChosen: true,
    coverage: {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }],
      cityPriorities: [],
    },
  });
  expect(status.complete).toBe(true);
});
```

Also **update the pre-existing empty-input assertion** in this file (search for the case that fed `shows: []` / empty coverage and expected slots/ladder/eligibility `done: true`) to expect `false` now — that old expectation encoded the vacuous-done behavior we are removing.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts`
Expected: FAIL (empty org still reports 3 done).

- [ ] **Step 3: Edit `computeBookingSetupStatus`**

Replace the `done` map body so empty collections read not-done:
```ts
  const coverage = input.coverage ? resolveCoverage(input.coverage) : undefined;
  const futureCount = input.coverage?.futurePairs.length ?? 0;
  const done: Record<BookingSetupStepKey, boolean> = {
    flow: input.flowChosen,
    slots: Array.isArray(input.shows)
      ? input.shows.length > 0 && input.shows.every((s) => s.main_cast_slots != null && s.understudy_slots != null)
      : false,
    ladder: coverage ? futureCount > 0 && coverage.uncoveredPairs.length === 0 : false,
    eligibility: coverage ? futureCount > 0 && coverage.uncoveredPairs.length === 0 && !coverage.hasNullCity : false,
    timing: input.timingChosen,
  };
```
Update the `BookingSetupStatusInput.shows` / `slots` doc comment to note that an empty shows list is now **outstanding**, not vacuously done.

- [ ] **Step 4: Wire `flowChosen` to `active` in `useBookingSetup.ts`**

Add `import { fetchShowsWithSlots, fetchOwnedSettingKeys, fetchBookingFlow } from "@/data/settings";` (extend the existing import). Add a query and fold it into loading + `flowChosen`:
```ts
  const flow = useQuery({
    queryKey: ["app-settings", "booking-flow", orgId],
    enabled: !!orgId,
    queryFn: () => fetchBookingFlow(supabase, orgId),
  });
```
```ts
  const isLoading = !!orgId && (owned.isLoading || shows.isLoading || coverage.isLoading || flow.isLoading);
```
```ts
    flowChosen: ownedSet ? ownedSet.has("booking_flow") && flow.data?.active === true : false,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts` → PASS.
Run: `npx vitest run src/hooks` (or the booking-setup hook test if present) → PASS.
Run: `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bookings/setupStatus.ts src/lib/bookings/setupStatus.test.ts src/hooks/useBookingSetup.ts
git commit -m "onboarding: require active flow and real data before marking steps done"
```

---

## Task 5: Provision edge — entitlements body + seed off flow  *(Wave 2, depends on Task 1)*

**Files:**
- Modify: `supabase/functions/provision-org/index.ts`
- Test: `supabase/functions/provision-org/index.di.test.ts`

**Interfaces:**
- Consumes: request body optional `entitlements?: Record<string, boolean>`; `FEATURE_KEYS`, `FEATURE_REGISTRY` (already imported); `normalizeBookingFlow` from `../_shared/bookingFlow.ts` (Task 1).
- Produces: `org_entitlements` seeded from `entitlements` when present; when the seeded `booking_flow` is enabled, an `app_settings` row `{ key: "booking_flow", value: { …, active: false } }` for the new org.

- [ ] **Step 1: Write the failing tests**

Add to `index.di.test.ts` (reuse the `makeFakeDeps` harness; assert on the recorded `from(...).insert/upsert` calls the fake captures — mirror how the existing "Task 9" entitlement-seeding test inspects them):

```ts
Deno.test("provision-org: explicit entitlements body seeds those exact rows", async () => {
  const { deps, /* capture helper used by the existing entitlement test */ } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" },
    body: { ...body, entitlements: { booking_flow: false, hire_orders: true } } }), deps);
  assertEquals(res.status, 200);
  // assert org_entitlements insert contains booking_flow:false and hire_orders:true
});

Deno.test("provision-org: enabling booking_flow seeds an inactive (off) flow policy", async () => {
  // body entitlements { booking_flow: true } → an app_settings upsert with key booking_flow, value.active === false
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all supabase/functions/provision-org/`
Expected: FAIL.

- [ ] **Step 3: Implement**

Extend the `Body` type with `entitlements?: Record<string, boolean>`. In the entitlement-seeding block, prefer the explicit body when present, validated against `FEATURE_KEYS` (drop unknown keys; missing keys fall back to the existing `default_entitlements`→registry resolution):
```ts
    const requested = body?.entitlements ?? null;
    const entitlementRows = FEATURE_KEYS.map((feature) => ({
      org_id,
      feature,
      enabled: requested && typeof requested[feature] === "boolean"
        ? requested[feature]
        : (defaultEntitlements[feature] ?? FEATURE_REGISTRY[feature].defaultEnabled),
    }));
```
After the `org_entitlements` insert, seed the off flow policy when booking is enabled (best-effort, same resilience posture as the surrounding code):
```ts
    const bookingEnabled = entitlementRows.find((r) => r.feature === "booking_flow")?.enabled ?? false;
    if (bookingEnabled) {
      try {
        const offFlow = normalizeBookingFlow({ active: false }); // classic fields, inactive
        const { error: flowErr } = await deps.admin.from("app_settings")
          .upsert({ org_id, key: "booking_flow", value: offFlow }, { onConflict: "org_id,key" });
        if (flowErr) console.error("provision-org: off-flow seed failed", flowErr.message);
      } catch (e) {
        console.error("provision-org: off-flow seed failed", (e as Error).message);
      }
    }
```
Add `import { normalizeBookingFlow } from "../_shared/bookingFlow.ts";`.

- [ ] **Step 4: Run tests + typecheck**

Run: `deno test --allow-all supabase/functions/provision-org/` → PASS.
Run: `deno check --node-modules-dir=none supabase/functions/provision-org/index.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/provision-org/index.ts supabase/functions/provision-org/index.di.test.ts
git commit -m "provision-org: seed entitlements from picker and land booking in off state"
```

---

## Task 6: `provisionOrg` data fn accepts `features`  *(Wave 1, no deps)*

**Files:**
- Modify: `src/data/platform.ts` (`provisionOrg`)
- Test: `src/data/platform.test.ts` (create if absent, using `supabaseFake`)

**Interfaces:**
- Produces: `provisionOrg(client, { name, slug, adminEmail, role?, appOrigin, features? })` where `features?: Record<FeatureKey, boolean>`; forwards it as body `entitlements`.

- [ ] **Step 1: Write the failing test**

Test with the call-recording fake (assert the `functions.invoke("provision-org", { body })` body carries `entitlements`). Model it on any existing `src/data/*.test.ts` that asserts an invoke body.

```ts
it("forwards features as the entitlements body", async () => {
  const { client, invokeCalls } = makeInvokeFake({ data: { org_id: "o1" }, error: null }); // adapt to supabaseFake
  await provisionOrg(client, { name: "A", slug: "a", adminEmail: "a@a.com", appOrigin: "https://app", features: { booking_flow: true, hire_orders: false } });
  expect(invokeCalls[0].body).toMatchObject({ entitlements: { booking_flow: true, hire_orders: false } });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/data/platform.test.ts` → FAIL.

- [ ] **Step 3: Implement** — extend the args type and body:
```ts
  args: { name: string; slug: string; adminEmail: string; role?: AppRole; appOrigin: string; features?: Record<FeatureKey, boolean> },
```
```ts
    body: { name: args.name, slug: args.slug, admin_email: args.adminEmail, role: args.role ?? "admin", app_origin: args.appOrigin, ...(args.features ? { entitlements: args.features } : {}) },
```

- [ ] **Step 4: Run** — `npx vitest run src/data/platform.test.ts` → PASS; `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/data/platform.ts src/data/platform.test.ts
git commit -m "provisionOrg: forward selected module entitlements"
```

---

## Task 7: NewOrgDialog module picker  *(depends on Task 6)*

**Files:**
- Modify: `src/components/platform/NewOrgDialog.tsx`
- Test: `src/components/platform/NewOrgDialog.test.tsx` (create if absent, `renderWithProviders`)

**Interfaces:**
- Consumes: `provisionOrg` `features` param (Task 6); `FEATURE_REGISTRY`, `FEATURE_KEYS`, `FeatureKey` from `@/lib/entitlements`; shadcn `Switch` (`@/components/ui/switch`).

- [ ] **Step 1: Write the failing test**

```tsx
it("defaults every module off and submits the chosen features", async () => {
  const provision = vi.spyOn(platform, "provisionOrg").mockResolvedValue("o1");
  renderWithProviders(<NewOrgDialog />);
  await userEvent.click(screen.getByRole("button", { name: /new organization/i }));
  await userEvent.type(screen.getByLabelText(/name/i), "Acme");
  await userEvent.type(screen.getByLabelText(/first admin email/i), "a@acme.com");
  await userEvent.click(screen.getByLabelText(/booking flow/i)); // turn one module on
  await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
  expect(provision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    features: { booking_flow: true, hire_orders: false },
  }));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/platform/NewOrgDialog.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

Extend the zod schema + `defaultValues` with `features` defaulting all-off, built from the registry so it stays data-driven:
```ts
const ALL_FEATURES_OFF = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;
```
Add `features: z.record(z.boolean())` to the schema (or a typed object), default `ALL_FEATURES_OFF`. Render a "Modules" section before the footer, one `Switch` per `FEATURE_KEYS` entry (label `FEATURE_REGISTRY[k].label`, helper text `.description`), bound to `form.watch("features")[k]` / `form.setValue`. Pass `features: v.features` into the `provisionOrg` mutation call.

- [ ] **Step 4: Run** — `npx vitest run src/components/platform/NewOrgDialog.test.tsx` → PASS; `npx tsc -p tsconfig.app.json --noEmit` → clean; `npm run lint -- src/components/platform/NewOrgDialog.tsx` → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/components/platform/NewOrgDialog.tsx src/components/platform/NewOrgDialog.test.tsx
git commit -m "add module picker to new organization dialog"
```

---

## Task 8: Changelog + version bump  *(Wave 3, after all feature tasks)*

**Files:**
- Modify: `package.json` (`version`), `src/config/app.config.ts` (`APP_META.VERSION`), `public/changelog.md`, `public/changelog.json` (regenerated)

**Judgment step:** read the current version and the top block of `public/changelog.md`. Current is `1.15.0`. If `1.15.0` is already an unreleased/same-day block, fold these bullets into it (same-day = one version, per convention); otherwise bump the MINOR to `1.16.0` in BOTH `package.json` and `APP_META.VERSION` and add a new newest-first block. Do NOT mention the module picker or provisioning (platform-only).

- [ ] **Step 1: Add the changelog block** (org-facing surfaces only)

```markdown
## 1.16.0 — <Mon D, YYYY>
*Booking flow you can switch off*

### New
- **Turn booking flow off** — A new Off option in Settings › Booking flow pauses all offers, reminders and confirmations for your workspace. Pick a flow again whenever you are ready.

### Fixed
- **Accurate setup checklist** — The dashboard setup checklist no longer counts a step as done before you have added the shows or dates it depends on.
```

- [ ] **Step 2: Bump `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts`** to match the block.

- [ ] **Step 3: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten. Never hand-edit it.

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "release: booking flow off state + accurate setup checklist"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — full unit suite green.
- [ ] `deno test --allow-all supabase/functions/` — full edge suite green (Task 1 edge change touches shared normalize; the whole suite must pass, not just the edited fns).
- [ ] `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.tools.json --noEmit` — clean.
- [ ] `npm run lint` — 0 warnings.
- [ ] `npm run sync:mirrors:check` — no drift (confirms we did NOT accidentally desync a generated mirror; `bookingFlow.ts` is hand-mirrored and not covered here, so also eyeball that both `bookingFlow.ts` files carry `active`).

## Self-review notes (spec coverage)

- Spec Part 1 (module picker) → Tasks 5, 6, 7. Picker defaults both off → Task 7.
- Spec Part 2 (off state: master switch + Off preset + runtime + Settings) → Tasks 1, 2, 3; provision seeds off → Task 5.
- Spec Part 3 (0-of-N: flowChosen requires active; vacuous-done fix) → Task 4.
- Back-compat (default `active:true`, no registry-default change, no migration) → Task 1 default + explicit Global Constraint; legacy no-row orgs untouched (only new orgs get a seeded off row).
- Hand-mirror obligation → Task 1 Step 4 + Global Constraints + final `sync:mirrors:check`.
- Type consistency: `active`, `PresetName "off"`, `applyPreset`/`matchPreset` signatures identical across Tasks 1/2/4; `features`/`entitlements` map shape identical across Tasks 5/6/7.
