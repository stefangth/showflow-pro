# Hardcoded-Values Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four substantive gaps found in self-review of the booking-engine defaults work: (a) the `BookingEngineDefaults` type can drift from its constant, (b) the new Platform "Booking engine defaults" UI has no wiring test, (c) the write-all-keys save behavior is undocumented and doesn't refresh the org Settings cache, (d) the login-hero foreground was changed from pure white to off-white (a visual change, not a pure refactor).

**Architecture:** `BookingEngineDefaults` stays an explicit `interface` matching the ~25 sibling shapes in `src/data/` (`OrgStat`, `StarterCatalogTemplate`, …); type↔const drift is guarded by the `app.config.test.ts` contract test rather than a clever mapped type. The Platform card gets a Testing-Library test that mocks the `@/data/*` layer (repo convention — never the supabase singleton) to prove load → edit → save. The login-hero text colour moves to an `--auth-fg` token so the value lives in `index.css` while staying exactly pure white.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Tailwind/shadcn, Vitest + @testing-library/react (`renderWithProviders`). **Local-env note:** no Node here — frontend `vitest`/`eslint`/`vite build` run in CI; the edge `deno` suite is unaffected by this plan.

---

## File Structure

**Create:**
- `src/components/platform/PlatformDefaultsTab.test.tsx` — wiring test for the booking-defaults card (load/edit/save).

**Modify:**
- `src/data/platform.ts` — derive `BookingEngineDefaults` from the const; document `savePlatformBookingDefaults` write-all behavior.
- `src/components/platform/PlatformDefaultsTab.tsx` — distinct "Save booking defaults" button; invalidate the org `app-settings` cache on save.
- `src/index.css` — add `--auth-fg` token.
- `src/pages/LoginPage.tsx` — hero wordmark + headline use `text-[var(--auth-fg)]`.

---

## Task 1: Make `BookingEngineDefaults` an explicit interface (match data-layer convention)

**Files:**
- Modify: `src/data/platform.ts:101-106`

- [ ] **Step 1: Confirm the data-layer tests are green (baseline)**

Run: `npx vitest run src/data/platform.test.ts`
Expected: PASS (all `data/platform` cases). *(CI — no Node locally.)*

- [ ] **Step 2: Use an `interface` (matches `StarterCatalogTemplate`/`OrgStat` — the data-layer convention)**

Replace the `type` alias:
```ts
export type BookingEngineDefaults = {
  offer_response_window_hours: number;
  offer_digest_hour_berlin: number;
  confirmation_digest_hour_berlin: number;
  resend_from_address: string;
};
```
with an interface:
```ts
/** Shape of the platform/org booking-engine settings (mirrors BOOKING_ENGINE_DEFAULTS). */
export interface BookingEngineDefaults {
  offer_response_window_hours: number;
  offer_digest_hour_berlin: number;
  confirmation_digest_hour_berlin: number;
  resend_from_address: string;
}
```

- [ ] **Step 3: Re-run the data-layer tests + typecheck**

Run: `npx vitest run src/data/platform.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (Type↔const drift is guarded by the `app.config.test.ts` contract test; an explicit interface keeps this file consistent with its ~25 sibling shapes.)

- [ ] **Step 4: Commit**

```bash
git add src/data/platform.ts
git commit -m "refactor(platform): keep BookingEngineDefaults an explicit interface"
```

---

## Task 2: Wiring test for the Platform booking-defaults card

**Files:**
- Create: `src/components/platform/PlatformDefaultsTab.test.tsx`
- Modify: `src/components/platform/PlatformDefaultsTab.tsx` (rename the booking card's button to a distinct, testable label)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/platform/PlatformDefaultsTab.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Mock the data-access layer (tested separately), never the supabase singleton —
// matches the repo convention (see AirtableSyncTab.test.tsx).
vi.mock("@/data/settings", () => ({
  resolveOrgSetting: vi.fn(() => Promise.resolve({ skills: [], cities: [], casts: [] })),
}));
vi.mock("@/data/platform", () => ({
  EMPTY_STARTER_TEMPLATE: { skills: [], cities: [], casts: [] },
  savePlatformSetting: vi.fn(() => Promise.resolve()),
  fetchPlatformBookingDefaults: vi.fn(),
  savePlatformBookingDefaults: vi.fn(() => Promise.resolve()),
}));

import { PlatformDefaultsTab } from "./PlatformDefaultsTab";
import { fetchPlatformBookingDefaults, savePlatformBookingDefaults } from "@/data/platform";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const DEFAULTS = {
  offer_response_window_hours: 36,
  offer_digest_hour_berlin: 18,
  confirmation_digest_hour_berlin: 21,
  resend_from_address: "Platform <p@x.com>",
};

describe("PlatformDefaultsTab — booking engine defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the platform booking defaults into the form", async () => {
    asMock(fetchPlatformBookingDefaults).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);
    const fromInput = await screen.findByLabelText("Default sender address (Resend)");
    expect((fromInput as HTMLInputElement).value).toBe("Platform <p@x.com>");
    expect((screen.getByLabelText("Offer response window (hours)") as HTMLInputElement).value).toBe("36");
    expect((screen.getByLabelText("Offer digest hour (Berlin)") as HTMLInputElement).value).toBe("18");
    expect((screen.getByLabelText("Confirmation digest hour (Berlin)") as HTMLInputElement).value).toBe("21");
  });

  it("saves edited values via savePlatformBookingDefaults", async () => {
    asMock(fetchPlatformBookingDefaults).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);
    const fromInput = await screen.findByLabelText("Default sender address (Resend)");
    fireEvent.change(fromInput, { target: { value: "New <n@ew.com>" } });
    fireEvent.click(screen.getByRole("button", { name: "Save booking defaults" }));
    await waitFor(() =>
      expect(savePlatformBookingDefaults).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          offer_response_window_hours: 36,
          offer_digest_hour_berlin: 18,
          confirmation_digest_hour_berlin: 21,
          resend_from_address: "New <n@ew.com>",
        }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/platform/PlatformDefaultsTab.test.tsx`
Expected: FAIL — the second test can't find a button named "Save booking defaults" (the card currently renders "Save defaults").

- [ ] **Step 3: Give the booking card a distinct button label**

In `BookingEngineDefaultsCard`, change the button:
```tsx
<Button onClick={() => save.mutate()} disabled={save.isPending}>Save booking defaults</Button>
```
(Leaves the starter card's "Save defaults" untouched, so the two save buttons are now unambiguous.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/platform/PlatformDefaultsTab.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/PlatformDefaultsTab.tsx src/components/platform/PlatformDefaultsTab.test.tsx
git commit -m "test(platform): cover booking-defaults card load/edit/save; distinct button label"
```

---

## Task 3: Document write-all behavior + refresh org cache on save

**Files:**
- Modify: `src/data/platform.ts` (doc comment on `savePlatformBookingDefaults`)
- Modify: `src/components/platform/PlatformDefaultsTab.tsx` (invalidate `["app-settings"]` on save)

- [ ] **Step 1: Document the write-all semantics**

Replace the one-line doc on `savePlatformBookingDefaults` with:
```ts
/**
 * Upsert ALL four platform-default booking-engine settings in one call (super-admin only).
 * Writes every key (even unchanged ones), so saving materializes platform rows for keys
 * that previously fell through to the code defaults — i.e. "Save" freezes the current
 * values as explicit platform defaults. Intended: this is the form for setting them.
 */
```

- [ ] **Step 2: Invalidate the org settings cache when platform defaults change**

In `BookingEngineDefaultsCard`'s mutation `onSuccess`, also bust the org Settings query so an org admin viewing Settings → Booking Engine sees the new inherited default:
```ts
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ["platform", "booking-defaults"] });
  qc.invalidateQueries({ queryKey: ["app-settings"] });
  toast.success("Booking engine defaults saved");
},
```

- [ ] **Step 3: Re-run the card test (save path still green)**

Run: `npx vitest run src/components/platform/PlatformDefaultsTab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/platform.ts src/components/platform/PlatformDefaultsTab.tsx
git commit -m "refactor(platform): document write-all defaults; refresh org settings cache on save"
```

---

## Task 4: Login-hero foreground as a token (true no-visual-change refactor)

**Files:**
- Modify: `src/index.css` (add `--auth-fg` to the auth-hero token block)
- Modify: `src/pages/LoginPage.tsx` (wordmark + headline)

- [ ] **Step 1: Add the token** (in the `:root` "Auth hero" block, beside `--auth-hairline`)

```css
--auth-fg: #ffffff;
```

- [ ] **Step 2: Use the token for the two hero text elements** (preserving pure white)

Wordmark span:
```tsx
<span className="font-display text-lg font-semibold tracking-tight text-[var(--auth-fg)]">
```
Headline:
```tsx
<h1 className="mb-7 max-w-sm font-display text-3xl font-semibold leading-[1.15] tracking-tight text-[var(--auth-fg)] sm:text-[34px]">
```

- [ ] **Step 3: Verify no hardcoded colour or off-white drift remains, and it builds**

Run: `rg -n "text-white|text-foreground" src/pages/LoginPage.tsx`
Expected: only the glass-card `text-foreground` (intentional, on the dark card) — the wordmark/headline now use `text-[var(--auth-fg)]`.
Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/pages/LoginPage.tsx
git commit -m "refactor(login): hero foreground via --auth-fg token (preserves pure white)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Frontend + edge suites + lint/build**

```bash
npx vitest run                                              # all frontend tests (CI)
deno test --allow-all --node-modules-dir=none supabase/functions/   # 504 passed (unaffected)
npm run lint && npm run build                               # clean + success (CI)
```

- [ ] **Step 2: Greps for residue**

```bash
rg -n "BOOKING_CONFIG|SOFT_BOOK_EXPIRY" src/ supabase/   # expect none
```

---

## Decisions / deliberate non-changes

- **Sender brand default (review #6).** `BOOKING_ENGINE_DEFAULTS.resend_from_address` keeps the ShowFlow brand as the *shipped* default but is now overridable per-platform in Platform → Defaults and per-org in Settings → Booking Engine — so a white-label operator changes it with zero code. Changing the shipped literal to a neutral value would alter production email sender on deploy, so it's left as-is unless explicitly requested.
- **Strict TDD observation (review #3).** Tests are written before the production change in each task, but this machine has no Node, so red→green is observed in CI, not locally. The edge suite (the one runnable locally) stays green.
- **Org Settings full-component test.** Not added: `SettingsPage` fans out many queries (cities/casts/shows/priorities/producers), so a full render is brittle and low-value; the org→platform→code precedence it relies on is already covered by `resolveOrgSetting` tests + the new card test.

## Self-Review

**1. Coverage:** review issues #2 (Task 2), #4 (Task 1), #5 (Task 3), #7-visual (Task 4), #7-cache (Task 3) each map to a task; #3/#6 + org-component-test are addressed under Decisions. ✓
**2. Placeholder scan:** every code step shows real code/commands; no TBD/"handle edge cases". ✓
**3. Type consistency:** `BookingEngineDefaults`, `fetchPlatformBookingDefaults`, `savePlatformBookingDefaults`, and the button label "Save booking defaults" are spelled identically across Tasks 1-3 and the test. ✓
