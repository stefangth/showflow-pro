# Booking Flow View-As Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `booking_flow` module gate reflect the editor "view as" preview, so a super-admin previewing as a regular user sees the same gated experience that user would (in-page surfaces, sidebar nav, and route access), and hide the booking status strip when the module is off.

**Architecture:** The `booking_flow` module gate is already enforced end-to-end (RLS, edge, and the in-page `ModuleGate`); this work only corrects the **UI preview** for super-admins. Today a super-admin is exempt from every UI gate, so toggling the module off and viewing a date changes nothing for them. The app already has a UI-only "view as" system (`viewAsRole` / `viewAsUser` on `AuthContext`, driven by the editor toolbar; it "never affects DB access"). We derive one predicate, `impersonating = viewAsRole != null || viewAsUser != null`, and suppress the super-admin exemption in the three gate points that have it: `useModuleGate` (in-page surfaces), `visibleNavItems` (sidebar lock), and `ProtectedRoute`'s feature gate (route access). Because the editor toolbar lives *inside* `AppLayout`, the route gate wraps its disabled screen in `AppLayout` for the previewing super-admin so they can still exit view-as. Separately, the booking funnel + up-next strip are moved behind the same gate so booking-engine status stops leaking when the module is off.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Tailwind/shadcn.

## Global Constraints

- **This is a UI-only change.** `viewAsRole` / `viewAsUser` never affect DB access (see the JSDoc on both in `AuthContext.tsx`). No migration, RLS, edge-function, or system-map change belongs in this plan; server-side `booking_flow` enforcement already shipped.
- **No changelog entry and no version bump.** `public/changelog.md` excludes platform-admin / module-toggle and editor-tool behavior; this has no customer-facing angle. Do not touch `package.json` or `APP_META.VERSION`.
- **`any` is banned** — lint is CI-gated at `--max-warnings 0`. Prefer the typed test helpers (`partialMock` from `@/test/castHelpers`); cast test fixtures with `as never` only where the existing neighboring tests already do.
- **Impersonation predicate is always `viewAsRole != null || viewAsUser != null`** (loose `!= null`, matching existing codebase usage e.g. `ArtistDashboard.tsx:110`). Loose `!= null` is required: test mocks built with `partialMock` leave these fields `undefined`, and `undefined != null` is `false`, so a non-impersonating super-admin keeps god-mode. Never use `!==`/`===` here or the existing "super-admin bypass" tests break.
- **Type-checking is three separate projects; none subsumes the others:** `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, and `deno check --node-modules-dir=none supabase/functions/*/index.ts`. This plan only touches `src/`, so `tsconfig.app.json` is the relevant one, but run `npm run lint` and the full vitest suite.
- **Semantic tokens only** in styling. This plan adds no new colors; the one Badge reuses the existing `bg-destructive/10 text-destructive`.
- **Tests import the real module.** Never re-implement production logic inside a test.
- **Scope boundary (do NOT change):** the super-admin exemption for *role* gating (`ProtectedRoute` role bypass at ~line 61, `visibleNavItems` super-admin-only item filter) and org gates (NoOrg / Suspended) stay as-is. Only the **feature/entitlement** exemptions change. The user's request is specifically about a user "gated on a feature."

---

### Task 1: `useModuleGate` honors view-as (in-page surfaces)

The core change. `ModuleGate` (used by the ShowDateDetailSheet offers card, both dashboards, and artist bookings) reads `useModuleGate`, whose super-admin exemption is the reason a previewing super-admin still sees live controls.

**Files:**
- Modify: `src/hooks/useEntitlements.ts` (`useModuleGate`, ~lines 43-49)
- Test: `src/hooks/useEntitlements.test.tsx` (create)

**Interfaces:**
- Consumes: `useAuth()` — now also reads `viewAsRole: AppRole | null` and `viewAsUser: ViewAsUser | null` (both already exist on the context). `useEntitlements()` (unchanged). `fetchEntitlements` from `@/data/entitlements` (mocked in the test).
- Produces: `useModuleGate(feature): { allow: boolean; pending: boolean }` — unchanged signature; new behavior: while impersonating, a super-admin is treated as a normal member.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useEntitlements.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/entitlements", () => ({ fetchEntitlements: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchEntitlements } from "@/data/entitlements";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useModuleGate } from "./useEntitlements";

function mockAuth(over: { isSuperAdmin?: boolean; viewAsRole?: string | null; viewAsUser?: unknown }) {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: "org-1" },
    isSuperAdmin: false,
    viewAsRole: null,
    viewAsUser: null,
    ...over,
  } as never);
}

async function gate() {
  const { result } = renderHookWithProviders(() => useModuleGate("booking_flow"));
  await waitFor(() => expect(result.current.pending).toBe(false));
  return result.current;
}

describe("useModuleGate view-as", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // booking_flow defaults ON, so an explicit disabled row is needed to turn it off.
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: false }] as never);
  });

  it("keeps god-mode for a super-admin who is NOT previewing", async () => {
    mockAuth({ isSuperAdmin: true });
    expect((await gate()).allow).toBe(true);
  });

  it("gates a super-admin previewing as a role", async () => {
    mockAuth({ isSuperAdmin: true, viewAsRole: "producer" });
    expect((await gate()).allow).toBe(false);
  });

  it("gates a super-admin previewing as a specific user", async () => {
    mockAuth({ isSuperAdmin: true, viewAsUser: { id: "u1", email: "a@b.c", roles: ["artist"] } });
    expect((await gate()).allow).toBe(false);
  });

  it("still allows a previewing super-admin when the module is actually on", async () => {
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: true }] as never);
    mockAuth({ isSuperAdmin: true, viewAsRole: "producer" });
    expect((await gate()).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useEntitlements.test.tsx`
Expected: FAIL — the two "gates a super-admin previewing" cases return `allow: true` (current exemption ignores view-as).

- [ ] **Step 3: Write the implementation**

In `src/hooks/useEntitlements.ts`, change `useModuleGate` to read the view-as fields and suppress the exemption while impersonating:

```ts
export function useModuleGate(feature: FeatureKey): { allow: boolean; pending: boolean } {
  const { features, isLoading } = useEntitlements();
  const { isSuperAdmin, viewAsRole, viewAsUser } = useAuth();
  // A super-admin previewing another user via the editor "view as" toolbar should
  // experience the gate exactly as that user would, so the god-mode exemption is
  // suppressed while impersonating. Outside preview, super-admins keep full access.
  const impersonating = viewAsRole != null || viewAsUser != null;
  if (isSuperAdmin && !impersonating) return { allow: true, pending: false };
  if (isLoading) return { allow: false, pending: true };
  return { allow: features.has(feature), pending: false };
}
```

Update the JSDoc bullet above the function that currently says "It exempts super-admins" to note the preview exception, e.g. append: "The exemption is dropped while the super-admin is previewing another user (`viewAsRole`/`viewAsUser`), so the editor 'view as' preview is faithful."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useEntitlements.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEntitlements.ts src/hooks/useEntitlements.test.tsx
git commit -m "make useModuleGate honor editor view-as for super-admins"
```

---

### Task 2: Sidebar nav lock honors view-as

`visibleNavItems` computes `locked` and exempts super-admins. Add an `impersonating` input and drop the exemption for the lock only (leave the super-admin-only item filter — e.g. Platform — untouched, per the scope boundary).

**Files:**
- Modify: `src/components/layout/navItems.ts` (`visibleNavItems` ctx type + the `lock` closure, ~lines 58-79)
- Modify: `src/components/layout/AppLayout.tsx:74` (pass `impersonating`)
- Test: `src/components/layout/navItems.test.ts`

**Interfaces:**
- Consumes: nothing new; `AppLayout` already destructures `viewAsRole, viewAsUser` from `useAuth` (line 36).
- Produces: `visibleNavItems(items, ctx)` where `ctx` gains an optional `impersonating?: boolean` (defaults to `false`, so all existing callers/tests are unaffected).

- [ ] **Step 1: Write the failing test**

Append to `src/components/layout/navItems.test.ts`. First extend the `ctx` helper (top of file) to accept `impersonating`:

```ts
const ctx = (over: Partial<{ isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; roles: string[]; enabledFeatures: Set<string>; entitlementsLoading: boolean; impersonating: boolean }> = {}) => {
  const { isEditorMode = false, isRealAdmin = false, isSuperAdmin = false, roles = [], enabledFeatures = new Set<string>(), entitlementsLoading = false, impersonating = false } = over;
  return { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r: string) => roles.includes(r), enabledFeatures, entitlementsLoading, impersonating };
};
```

Then add a test inside the existing `describe("feature gating", ...)` block:

```ts
it("locks a feature item for a super-admin who is previewing via view-as", () => {
  const items = [
    { to: "/x", icon: NAV_ITEMS[0].icon, label: "X", section: "workspace", feature: "hire_orders" } as NavItem,
  ];
  const previewing = visibleNavItems(items, ctx({ isEditorMode: true, isRealAdmin: true, isSuperAdmin: true, impersonating: true }));
  expect(previewing[0].locked).toBe(true);

  const normal = visibleNavItems(items, ctx({ isEditorMode: true, isRealAdmin: true, isSuperAdmin: true, impersonating: false }));
  expect(normal[0].locked).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/navItems.test.ts`
Expected: FAIL — the previewing case is `locked: false` (super-admin exemption ignores view-as).

- [ ] **Step 3: Write the implementation**

In `src/components/layout/navItems.ts`, add `impersonating?: boolean` to the `ctx` type and change the `lock` closure:

```ts
export function visibleNavItems(
  items: NavItem[],
  ctx: {
    isEditorMode: boolean;
    isRealAdmin: boolean;
    isSuperAdmin: boolean;
    hasRole: (r: string) => boolean;
    enabledFeatures: Set<string>;
    entitlementsLoading: boolean;
    impersonating?: boolean;
  },
): VisibleNavItem[] {
  const lock = (item: NavItem): VisibleNavItem => ({
    ...item,
    // Super-admins are normally never locked, but a super-admin previewing another
    // user via the editor "view as" toolbar should see that user's locks.
    locked: !ctx.entitlementsLoading && !!item.feature
      && (!ctx.isSuperAdmin || !!ctx.impersonating)
      && !ctx.enabledFeatures.has(item.feature),
  });
  // ...rest of the function body is unchanged (the superAdmin-only item filter stays on ctx.isSuperAdmin)
```

In `src/components/layout/AppLayout.tsx`, at the `visibleNavItems` call (line 74), pass `impersonating` derived from the already-destructured fields:

```ts
  const filteredNav = visibleNavItems(NAV_ITEMS, { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r) => hasRole(r as AppRole), enabledFeatures: features, entitlementsLoading, impersonating: viewAsRole != null || viewAsUser != null });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/layout/navItems.test.ts`
Expected: PASS (existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/navItems.ts src/components/layout/navItems.test.ts src/components/layout/AppLayout.tsx
git commit -m "lock feature nav items for super-admins previewing view-as"
```

---

### Task 3: Route feature gate honors view-as, keeping the toolbar exit

`ProtectedRoute` bounces to `FeatureDisabledScreen` for unentitled orgs but exempts super-admins. Drop the exemption while previewing. Because the editor toolbar lives inside `AppLayout` and `AppLayout` is the *child* of `ProtectedRoute`, a bare disabled screen would strand the super-admin with no way to exit view-as — so wrap the disabled screen in `AppLayout` for the (only-ever-previewing) super-admin who reaches it.

**Files:**
- Modify: `src/features/auth/ProtectedRoute.tsx` (useAuth destructure ~line 18, feature gate ~lines 49-51, plus an `AppLayout` import)
- Test: `src/features/auth/ProtectedRoute.test.tsx`

**Interfaces:**
- Consumes: `AppLayout` (default export from `@/components/layout/AppLayout`); `viewAsRole` / `viewAsUser` from `useAuth`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

In `src/features/auth/ProtectedRoute.test.tsx`, add an `AppLayout` mock alongside the existing `vi.mock` calls (near the `NoOrgScreen`/`SuspendedOrgScreen` stubs):

```ts
vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "app-layout" }, children),
}));
```

Then add a test inside the existing `describe("feature gating", ...)` block (its `beforeEach` already injects `ROUTE_FEATURES["/protected"] = "hire_orders"`):

```ts
it("shows the feature gate, inside AppLayout, to a super-admin previewing via view-as", () => {
  vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
    user: partialMock<User>({ id: "user-1" }),
    loading: false,
    roles: ["admin"],
    currentOrg: ACTIVE_ORG,
    isSuperAdmin: true,
    viewAsRole: "producer",
  }));
  vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
    features: new Set(),
    isLoading: false,
  }));

  renderProtected();

  expect(screen.getByText("Hire orders is not enabled")).toBeTruthy();
  expect(screen.queryByText("Protected Content")).toBeNull();
  // Wrapped in AppLayout so the editor toolbar (its child) stays reachable to exit view-as.
  expect(screen.getByTestId("app-layout")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/auth/ProtectedRoute.test.tsx`
Expected: FAIL — the previewing super-admin currently bypasses the gate and renders "Protected Content".

- [ ] **Step 3: Write the implementation**

In `src/features/auth/ProtectedRoute.tsx`:

Add the import near the other page imports:

```tsx
import AppLayout from '@/components/layout/AppLayout';
```

Add `viewAsRole, viewAsUser` to the `useAuth()` destructure:

```tsx
  const { user, loading, roles, currentOrg, isSuperAdmin, viewAsRole, viewAsUser } = useAuth();
```

Replace the feature-gate block (currently the three-line `if (requiredFeature && ... && !isSuperAdmin)`):

```tsx
  const requiredFeature = requiredFeatureForPath(location.pathname);
  const impersonating = viewAsRole != null || viewAsUser != null;
  if (requiredFeature && !entitlementsLoading && !features.has(requiredFeature) && !(isSuperAdmin && !impersonating)) {
    const disabled = <FeatureDisabledScreen feature={requiredFeature} />;
    // A super-admin only reaches this branch while previewing (view-as); keep the
    // editor toolbar (which lives inside AppLayout) on screen so they can exit the
    // preview. A genuine member has no toolbar and needs no chrome here.
    return isSuperAdmin ? <AppLayout>{disabled}</AppLayout> : disabled;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/auth/ProtectedRoute.test.tsx`
Expected: PASS — including the pre-existing "lets a super-admin bypass the feature gate" test (no `viewAsRole` set there → `impersonating` is `false` → bypass preserved).

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/ProtectedRoute.tsx src/features/auth/ProtectedRoute.test.tsx
git commit -m "gate feature routes for super-admins previewing view-as"
```

---

### Task 4: Gate the booking status strip (funnel + up-next)

`BookingFunnel` + `UpNextStrip` render outside the module gate, so booking-engine status leaks whenever the module is off (for every viewer, and now for a previewing super-admin). Extract them into a named `BookingStatusSection` gated on `booking_flow`, hidden (no notice) when off — the confirmed cast stays visible via `BookingCardSection`'s read-only preview below.

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (imports; the funnel/up-next block ~lines 648-668; add the `BookingStatusSection` export)
- Test: `src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx`

**Interfaces:**
- Consumes: `useModuleGate` from `@/hooks/useEntitlements` (Task 1); `BookingFunnel`, `UpNextStrip`, `Badge`, `computeUpNext`, and types `UpNextItem` (`@/lib/bookingCockpit`), `SlotCounts` (`@/lib/settings`).
- Produces: `BookingStatusSection({ bookings, slots, upNextItems, programLabel })` — named export.

- [ ] **Step 1: Write the failing test**

Append to `src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx` (it already mocks `@/hooks/useEntitlements` so that `useModuleGate(f)` returns `{ allow: useFeature(f), pending: false }`). Add the import at the top alongside the existing `BookingCardSection` import:

```tsx
import { BookingCardSection, BookingStatusSection } from "./ShowDateDetailSheet";
```

Add a new describe block:

```tsx
describe("ShowDateDetailSheet booking status strip gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the funnel when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<BookingStatusSection bookings={[]} slots={null} upNextItems={[]} programLabel="Cats" />);
    expect(screen.getByLabelText("Booking funnel")).toBeInTheDocument();
  });

  it("renders nothing when booking_flow is off", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    const { container } = render(
      <BookingStatusSection bookings={[]} slots={null} upNextItems={[]} programLabel="Cats" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx`
Expected: FAIL — `BookingStatusSection` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/components/shows/ShowDateDetailSheet.tsx`:

Add `useModuleGate` to the existing entitlements import (line 56):

```tsx
import { useFeature, useModuleGate } from '@/hooks/useEntitlements';
```

Add the two type imports (place beside the existing related imports):

```tsx
import type { UpNextItem } from '@/lib/bookingCockpit';
import type { SlotCounts } from '@/lib/settings';
```

Add the named component near `BookingCardSection`:

```tsx
/** The booking funnel + up-next strip, shown to every viewer of a date. Both are
 *  pure booking-engine status, so they hide entirely when booking_flow is off (the
 *  confirmed cast stays visible via BookingCardSection's read-only preview below).
 *  Uses useModuleGate, so a super-admin previewing view-as sees it hidden too. */
export function BookingStatusSection({ bookings, slots, upNextItems, programLabel }: {
  bookings: Array<{ status: string; is_understudy: boolean }>;
  slots: SlotCounts | null;
  upNextItems: UpNextItem[];
  programLabel: string;
}) {
  const { allow } = useModuleGate('booking_flow');
  if (!allow) return null;
  return (
    <div className="space-y-3">
      <BookingFunnel bookings={bookings} slots={slots} />
      <UpNextStrip items={upNextItems} />
      {!slots && (
        <Badge variant="secondary" className="bg-destructive/10 text-destructive">
          Slot config missing for {programLabel}. Set cast slots in Settings.
        </Badge>
      )}
    </div>
  );
}
```

Replace the inline funnel/up-next block (the `{/* Booking funnel + up-next strip */}` `<div className="space-y-3">…</div>`, ~lines 648-668) with:

```tsx
              {/* Booking funnel + up-next strip (gated: pure booking-engine status) */}
              <BookingStatusSection
                bookings={bookingsForDate ?? []}
                slots={slotConfig}
                upNextItems={computeUpNext({
                  flow,
                  times: effectiveTimes,
                  pendingCount: (bookingsForDate ?? []).filter((b) => b.status === 'suggested').length,
                  nextExpiry: (bookingsForDate ?? [])
                    .filter((b) => b.status === 'suggested' && b.offer_expires_at)
                    .map((b) => b.offer_expires_at as string)
                    .sort()[0] ?? null,
                  hasOpenTier: (openedQ.data ?? []).some((t) => !t.closedAt),
                })}
                programLabel={showDate.show?.program ?? 'this show'}
              />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/shows/`
Expected: PASS, including the pre-existing sheet tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx
git commit -m "hide the booking status strip when booking_flow is off"
```

---

### Task 5: Full verification (automated + manual)

**Files:** none (verification only).

- [ ] **Step 1: Run every automated gate**

```bash
npm run lint
```

```bash
npx vitest run
```

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: all pass. (No edge/Deno or migration changes in this plan, so `deno` and pgTAP are not needed; `tsconfig.tools.json` is untouched but harmless to run.)

- [ ] **Step 2: Manual smoke test in the running app**

Preconditions: signed in as a super-admin; one org whose `booking_flow` module is toggled OFF (Platform console → Edit org). Enter that org.

1. Open a show date's detail sheet as the super-admin, **not** in view-as. Expected: offers card, funnel, and up-next all render live (god-mode preserved).
2. Open the editor toolbar, choose "view as" a producer (or any user/role). Expected: the offers card is replaced by the "Booking flow is not enabled" notice with the confirmed cast read-only; the funnel + up-next strip disappear; the sidebar shows the booking-flow nav item locked.
3. Navigate to a booking_flow-gated route (`/availability`) while previewing as an artist. Expected: `FeatureDisabledScreen`, but the editor toolbar remains visible so you can drop view-as.
4. Exit view-as. Expected: everything returns to full god-mode.

- [ ] **Step 3: Commit (only if manual testing required a fix)**

```bash
git add -A
git commit -m "fix issues found during view-as gating verification"
```

---

## Self-Review

**Spec/decision coverage:**

| Decision (from the session) | Task |
|---|---|
| In-page booking surfaces reflect view-as | 1 (`useModuleGate`) — covers all five `ModuleGate` consumers |
| Also lock nav during view-as | 2 |
| Also lock routes during view-as | 3 |
| Don't strand the previewing super-admin (toolbar exit) | 3 (AppLayout wrap) |
| Hide funnel + up-next when module off | 4 |
| UI-only; no server/RLS/system-map change | Global Constraints |
| No changelog / version bump | Global Constraints |
| Leave role gating + super-admin-only items alone | Global Constraints (scope boundary), respected by Tasks 2-3 |

No gaps.

**Placeholder scan:** none — every code step has concrete code.

**Type consistency:** `impersonating` is derived identically (`viewAsRole != null || viewAsUser != null`) in Tasks 1, 2 (AppLayout), and 3. `useModuleGate(feature): { allow, pending }` is unchanged in signature and consumed as `{ allow }` in Task 4. `BookingStatusSection({ bookings, slots, upNextItems, programLabel })` is defined and consumed with those exact prop names within Task 4. `visibleNavItems` gains `impersonating?: boolean` (optional, so Task 2's AppLayout change and existing callers stay valid).

**Verified while planning:**
- `AppLayout.tsx:36` already destructures `viewAsRole, viewAsUser`, so Task 2 adds no new destructure.
- `ProtectedRoute`'s feature gate runs *before* both role bypasses, so making it view-as-aware takes effect without touching role logic.
- `AppLayout` does not import `ProtectedRoute`, so Task 3's `AppLayout` import introduces no cycle.
- The repo has no `eqeqeq` lint rule and uses `!= null` idiomatically, so the loose-null predicate is lint-clean.
- The existing `ShowDateDetailSheet.moduleGate.test.tsx` mock already exposes `useModuleGate` via `useFeature`, so Task 4's test reuses it with no new mock.
