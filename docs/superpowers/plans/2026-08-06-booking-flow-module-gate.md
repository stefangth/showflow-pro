# Booking Flow Module Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `booking_flow` from a configuration-only entitlement into a real module, so that switching it off actually stops the booking engine and visibly greys every booking surface.

**Architecture:** Three independent layers enforce one predicate, `is_feature_enabled(org, 'booking_flow')`. The DB gets new RESTRICTIVE write policies on `bookings` (INSERT/UPDATE/DELETE only — SELECT stays open so confirmed cast remains readable) plus an entitlement early-return in the understudy trigger. Edge functions gate with `requireFeature`; crons filter their org list with the existing `filterEntitledOrgs`. The frontend adds one `ModuleGate` component used by five surfaces, plus nav/route gating that reuses machinery `hire_orders` already has.

**Tech Stack:** React 18 + TypeScript + Tailwind/shadcn, Vitest + @testing-library/react, Deno edge functions, Postgres RLS + pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-06-booking-flow-module-gate-design.md`

## Global Constraints

- **`any` is banned** — lint is CI-gated at `--max-warnings 0`. For untyped Supabase joins, declare a local row `interface` and cast once with `as unknown as Row[]` right after the error check.
- **Type-checking is three separate projects; none subsumes the others:** `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, and `deno check --node-modules-dir=none supabase/functions/*/index.ts`.
- **Edge Deno tests need `--node-modules-dir=none`.**
- **Migrations are NOT auto-applied on merge.** Only edge functions and the frontend auto-deploy. The migration in Task 7 must be applied manually via the Supabase MCP `apply_migration`, and the file must be named to match the real timestamp `apply_migration` records. Never edit an applied migration — follow up with `CREATE OR REPLACE`.
- **pgTAP needs no Docker.** Run the test file through `execute_sql` wrapped in `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; … ROLLBACK;`.
- **No em-dashes or en-dashes in user-facing copy** (UI strings, alerts, emails). Use a period, comma, or colon.
- **Automation changes must update both** `docs/system-map.md` **and** `src/data/systemMap.ts` **in the same PR.** Tasks 5, 6 and 7 change automation behaviour and therefore carry system-map edits (folded into Task 8).
- **Semantic tokens only** in styling: `bg-background`, `text-muted-foreground`, `border-border`. Never `bg-white` / `text-black`.
- **Tests import the real module.** Never re-implement production logic inside a test.
- **No changelog entry and no version bump for this work.** `public/changelog.md` explicitly excludes org-module toggles and anything platform-admin-facing, and `booking_flow` stays `defaultEnabled: true`, so no existing org's behaviour changes on deploy. There is no customer-facing angle to write. Do not touch `package.json` or `APP_META.VERSION`.

---

### Task 1: `ModuleGate` component

The one shared primitive for "this module is off, here is why". Five surfaces use it in later tasks.

Critical design point: when locked it does **not** render `children`. Mounting them would fire their React Query calls for data the user cannot act on. Consumers that still want something visible pass a static `preview`.

**Files:**
- Create: `src/components/layout/ModuleGate.tsx`
- Test: `src/components/layout/ModuleGate.test.tsx`

**Interfaces:**
- Consumes: `useFeature(feature: FeatureKey): boolean` from `@/hooks/useEntitlements`; `FEATURE_REGISTRY` from `@/lib/entitlements`.
- Produces: `ModuleGate({ feature, children, preview }): JSX.Element` — named export. `feature: FeatureKey`, `children: ReactNode` (rendered only when entitled), `preview?: ReactNode` (rendered inert when locked). Locked branch always renders an element with `data-testid={`module-gate-${feature}`}`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
import { useFeature } from "@/hooks/useEntitlements";
import { ModuleGate } from "./ModuleGate";

describe("ModuleGate", () => {
  it("renders children untouched when the feature is enabled", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<ModuleGate feature="booking_flow"><button>Open tier</button></ModuleGate>);
    expect(screen.getByRole("button", { name: "Open tier" })).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("does NOT mount children when locked, so their queries never fire", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    const spy = vi.fn();
    function Child() { spy(); return <button>Open tier</button>; }
    render(<ModuleGate feature="booking_flow"><Child /></ModuleGate>);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open tier" })).not.toBeInTheDocument();
  });

  it("names the module in the notice when locked", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<ModuleGate feature="booking_flow"><span>x</span></ModuleGate>);
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.getByText("Booking flow is not enabled")).toBeInTheDocument();
  });

  it("renders the preview inert when locked", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(
      <ModuleGate feature="booking_flow" preview={<span>Ada Lovelace</span>}>
        <button>Open tier</button>
      </ModuleGate>,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("module-gate-preview")).toHaveClass("pointer-events-none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/ModuleGate.test.tsx`
Expected: FAIL — cannot resolve `./ModuleGate`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFeature } from "@/hooks/useEntitlements";
import { FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";

/**
 * In-page gate for an org module. When the current org is entitled this is a
 * transparent pass-through. When it is not, `children` are deliberately NOT
 * mounted (that would fire their queries for data the viewer cannot act on);
 * instead the viewer gets a standard notice plus an optional static `preview`
 * the consumer supplies, rendered non-interactive.
 *
 * Copy is derived from FEATURE_REGISTRY so it cannot drift from
 * FeatureDisabledScreen, which gates the route-level equivalent.
 */
export function ModuleGate({ feature, children, preview }: {
  feature: FeatureKey;
  children: ReactNode;
  preview?: ReactNode;
}) {
  const enabled = useFeature(feature);
  if (enabled) return <>{children}</>;
  const def = FEATURE_REGISTRY[feature];
  return (
    <div data-testid={`module-gate-${feature}`} className="space-y-3">
      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle>{def.label} is not enabled</AlertTitle>
        <AlertDescription>
          This module is not part of your organization's plan. Contact your ShowFlow
          administrator to enable it.
        </AlertDescription>
      </Alert>
      {preview && (
        <div data-testid="module-gate-preview" aria-hidden className="pointer-events-none select-none opacity-60">
          {preview}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/layout/ModuleGate.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/ModuleGate.tsx src/components/layout/ModuleGate.test.tsx
git commit -m "add ModuleGate for in-page entitlement gating"
```

---

### Task 2: Module chrome — nav lock, route gate, badge suppression, settings copy

Four small changes that all concern how the module presents itself outside the booking surfaces themselves.

`visibleNavItems` already converts a `feature` key into `locked: true` for unentitled non-super-admins, and the sidebar already renders locked items greyed and inert. So the nav change is one field.

**Files:**
- Modify: `src/components/layout/navItems.ts` (the `ROUTES.AVAILABILITY` entry)
- Modify: `src/config/app.config.ts` (`ROUTE_FEATURES`)
- Modify: `src/hooks/useNavCounts.ts` (suppress `openOffers` and `pendingConfirmations`)
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.tsx:131-139` (locked alert copy)
- Test: `src/components/layout/navItems.test.ts`, `src/config/app.config.test.ts`, `src/hooks/useNavCounts.test.tsx`, `src/components/settings/bookingFlow/BookingFlowTab.test.tsx`

**Interfaces:**
- Consumes: `NavItem.feature?: FeatureKey` and `visibleNavItems(items, ctx)` (already exist); `requiredFeatureForPath(pathname)` (already exists).
- Produces: no new exports. `useNavCounts()` keeps its signature `{ pendingConfirmations: number; openOffers: number; awaitingCountersign: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/layout/navItems.test.ts`:

```ts
it("locks the Availability item when booking_flow is off", () => {
  const items = visibleNavItems(NAV_ITEMS, {
    isEditorMode: false, isRealAdmin: false, isSuperAdmin: false,
    hasRole: (r) => r === "artist",
    enabledFeatures: new Set<string>(),
    entitlementsLoading: false,
  });
  const availability = items.find((i) => i.to === ROUTES.AVAILABILITY);
  expect(availability?.locked).toBe(true);
});

it("leaves Availability unlocked when booking_flow is on", () => {
  const items = visibleNavItems(NAV_ITEMS, {
    isEditorMode: false, isRealAdmin: false, isSuperAdmin: false,
    hasRole: (r) => r === "artist",
    enabledFeatures: new Set<string>(["booking_flow"]),
    entitlementsLoading: false,
  });
  expect(items.find((i) => i.to === ROUTES.AVAILABILITY)?.locked).toBe(false);
});
```

Append to `src/config/app.config.test.ts`:

```ts
it("gates /availability behind booking_flow", () => {
  expect(ROUTE_FEATURES["/availability"]).toBe("booking_flow");
  expect(requiredFeatureForPath("/availability")).toBe("booking_flow");
});
```

Create `src/hooks/useNavCounts.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
vi.mock("@/data/bookings", () => ({
  fetchPendingConfirmationsCount: vi.fn().mockResolvedValue(3),
  fetchMyOpenOffersCount: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/data/hireOrders", () => ({ fetchAwaitingCountersignCount: vi.fn().mockResolvedValue(0) }));

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useNavCounts } from "./useNavCounts";

describe("useNavCounts booking_flow gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" }, hasRole: () => true } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
  });

  it("does not query booking counts when booking_flow is off", async () => {
    vi.mocked(useFeature).mockImplementation((f) => f !== "booking_flow");
    const { result } = renderHookWithProviders(() => useNavCounts());
    expect(fetchPendingConfirmationsCount).not.toHaveBeenCalled();
    expect(fetchMyOpenOffersCount).not.toHaveBeenCalled();
    expect(result.current.pendingConfirmations).toBe(0);
    expect(result.current.openOffers).toBe(0);
  });
});
```

Append to `src/components/settings/bookingFlow/BookingFlowTab.test.tsx` (inside the existing locked describe block):

```tsx
it("tells the admin the pipeline is stopped, not running the standard flow", async () => {
  renderTab({ orgId: "org-locked" });
  expect(await screen.findByText("Booking flow is not enabled")).toBeInTheDocument();
  expect(screen.queryByText(/runs the standard flow/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/layout/navItems.test.ts src/config/app.config.test.ts src/hooks/useNavCounts.test.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
Expected: FAIL — `locked` is `false`, `ROUTE_FEATURES["/availability"]` is `undefined`, the fetches are called, and the old copy is still present.

- [ ] **Step 3: Write the implementation**

In `src/components/layout/navItems.ts`, add `feature: 'booking_flow'` to the Availability entry:

```ts
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', section: 'workspace', roles: ['artist'], feature: 'booking_flow', badge: 'openOffers' },
```

In `src/config/app.config.ts`, add to `ROUTE_FEATURES`:

```ts
  '/availability': 'booking_flow',
```

In `src/hooks/useNavCounts.ts`, add the entitlement and fold it into both `enabled` flags:

```ts
  const hasBookingFlow = useFeature("booking_flow");
```

then change the two `enabled` lines to:

```ts
    enabled: canSeeOrgBookings && !!orgId && hasBookingFlow,   // pending
    enabled: !!artistId && hasBookingFlow,                     // offers
```

A disabled query leaves `data` undefined, and the existing return already coalesces to `0`.

In `src/components/settings/bookingFlow/BookingFlowTab.tsx`, replace the `AlertDescription` body at line ~134:

```tsx
          <AlertDescription>
            Booking is switched off for your organization, so no offers, reminders or
            confirmations are sent. Contact your ShowFlow administrator to enable it.
          </AlertDescription>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/layout/navItems.test.ts src/config/app.config.test.ts src/hooks/useNavCounts.test.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/navItems.ts src/config/app.config.ts src/hooks/useNavCounts.ts src/components/settings/bookingFlow/BookingFlowTab.tsx src/components/layout/navItems.test.ts src/config/app.config.test.ts src/hooks/useNavCounts.test.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx
git commit -m "lock availability nav and route behind booking_flow"
```

---

### Task 3: Gate the ShowDateDetailSheet booking card

The producer-facing centrepiece. The whole "Offers" / "Book artists" card is replaced by the gate notice, with a read-only confirmed-cast list as the `preview` so producers keep sight of who is booked (spec decision 3).

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (the booking card at ~line 716, and the imports)
- Test: `src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx`

**Interfaces:**
- Consumes: `ModuleGate` from Task 1 (`{ feature, children, preview }`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
vi.mock("@/components/shows/TierTimeline", () => ({
  TierTimeline: () => <div data-testid="tier-timeline" />,
}));

import { useFeature } from "@/hooks/useEntitlements";
import { BookingCardSection } from "./ShowDateDetailSheet";

const CAST = [
  { id: "b1", status: "confirmed", is_understudy: false, artist: { id: "a1", name: "Ada Lovelace" } },
];

describe("ShowDateDetailSheet booking card gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the offers UI when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<BookingCardSection bookings={CAST as never}>{<div data-testid="offers" />}</BookingCardSection>);
    expect(screen.getByTestId("offers")).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("replaces the offers UI with the gate and keeps the confirmed cast readable", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<BookingCardSection bookings={CAST as never}>{<div data-testid="offers" />}</BookingCardSection>);
    expect(screen.queryByTestId("offers")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx`
Expected: FAIL — `BookingCardSection` is not exported.

- [ ] **Step 3: Write the implementation**

Extract the card wrapper into a named export in `src/components/shows/ShowDateDetailSheet.tsx`, so it is testable without mounting the whole sheet. Add near the other component definitions:

```tsx
/** The booking card shell. Entitled: renders the offers / direct-book UI passed as
 *  children. Not entitled: renders the module notice with a read-only confirmed
 *  cast list, so a producer still sees who is booked while every control is gone. */
export function BookingCardSection({ bookings, children }: {
  bookings: BookingWithArtist[];
  children: React.ReactNode;
}) {
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  return (
    <ModuleGate
      feature="booking_flow"
      preview={
        confirmed.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Confirmed cast</p>
            {confirmed.map((b) => (
              <p key={b.id} className="text-sm text-muted-foreground">{b.artist?.name}</p>
            ))}
          </div>
        ) : null
      }
    >
      {children}
    </ModuleGate>
  );
}
```

Add the import at the top of the file:

```tsx
import { ModuleGate } from '@/components/layout/ModuleGate';
```

Then wrap the existing card body. The current JSX at ~line 716 reads:

```tsx
              {canManage && showDate.status !== 'cancelled' && (
                <Card>
```

Change it to wrap the whole `<Card>…</Card>` in the new section:

```tsx
              {canManage && showDate.status !== 'cancelled' && (
                <BookingCardSection bookings={bookingsForDate ?? []}>
                  <Card>
```

and close it with `</BookingCardSection>` after the matching `</Card>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/shows/`
Expected: PASS, including the pre-existing sheet tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx src/components/shows/ShowDateDetailSheet.moduleGate.test.tsx
git commit -m "gate the show date booking card behind booking_flow"
```

---

### Task 4: Gate the dashboard and artist booking surfaces

`DirectBookingCard` and `TierAttentionCard` are pure presentational components whose page owns the query and gating, so the gate belongs in `DashboardPage`, not in the cards.

**Files:**
- Modify: `src/pages/DashboardPage.tsx:293-305`
- Modify: `src/components/dashboard/ArtistDashboard.tsx`
- Modify: `src/components/bookings/ArtistBookingsView.tsx`
- Test: `src/pages/DashboardPage.moduleGate.test.tsx`, and additions to `src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`

**Interfaces:**
- Consumes: `ModuleGate` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/pages/DashboardPage.moduleGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
import { useFeature } from "@/hooks/useEntitlements";
import { ProducerBookingSection } from "./DashboardPage";

describe("DashboardPage producer booking section", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the cards when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.getByTestId("cards")).toBeInTheDocument();
  });

  it("replaces them with the gate notice when off", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.queryByTestId("cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
  });
});
```

Append to `src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`:

```tsx
it("shows the module notice instead of offers when booking_flow is off", async () => {
  vi.mocked(useFeature).mockImplementation((f) => f !== "booking_flow");
  renderDashboard();
  expect(await screen.findByTestId("module-gate-booking_flow")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/DashboardPage.moduleGate.test.tsx src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`
Expected: FAIL — `ProducerBookingSection` is not exported; the artist dashboard has no gate.

- [ ] **Step 3: Write the implementation**

In `src/pages/DashboardPage.tsx`, add the import and a named export:

```tsx
import { ModuleGate } from '@/components/layout/ModuleGate';

/** Producer dashboard booking region. One gate for both attention cards, since
 *  neither is meaningful without the booking module. */
export function ProducerBookingSection({ children }: { children: React.ReactNode }) {
  return <ModuleGate feature="booking_flow">{children}</ModuleGate>;
}
```

Wrap the two card renders at lines 293-305:

```tsx
      <ProducerBookingSection>
        {flow.artist_acceptance && (
          <TierAttentionCard
            items={attentionItems}
            hint={deliveryHint(flow)}
            reference={reference}
            customFieldKey={customFieldKey}
          />
        )}

        {!flow.artist_acceptance && (
          <DirectBookingCard items={directItems} reference={reference} customFieldKey={customFieldKey} />
        )}
      </ProducerBookingSection>
```

In `src/components/dashboard/ArtistDashboard.tsx`, import `ModuleGate` and wrap the offers/bookings region (the card listing pending offers and the response meter) in `<ModuleGate feature="booking_flow">…</ModuleGate>`. Leave the hire-orders region outside the gate — the modules are independent (spec §5).

In `src/components/bookings/ArtistBookingsView.tsx`, import `ModuleGate` and wrap the component's returned booking list in `<ModuleGate feature="booking_flow">…</ModuleGate>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/ src/components/dashboard/ src/components/bookings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.moduleGate.test.tsx src/components/dashboard/ArtistDashboard.tsx src/components/dashboard/ArtistDashboard.flowCopy.test.tsx src/components/bookings/ArtistBookingsView.tsx
git commit -m "gate dashboard and artist booking surfaces behind booking_flow"
```

---

### Task 5: `requireFeature` on the offer-tier edge functions

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts`
- Modify: `supabase/functions/close-offer-tier/index.ts`
- Test: `supabase/functions/open-offer-tier/index.di.test.ts`, `supabase/functions/close-offer-tier/index.di.test.ts`

**Interfaces:**
- Consumes: `requireFeature(deps: Deps, orgId: string, feature: FeatureKey): Promise<Response | null>` from `../_shared/entitlements.ts`. Returns `null` to continue, or a ready 403 `Response` with body `{ error: "feature_disabled" }`.
- Produces: both functions now answer 403 `{ error: "feature_disabled" }` for unentitled orgs.

- [ ] **Step 1: Write the failing tests**

Append to each function's `index.di.test.ts` (shown for `open-offer-tier`; mirror it in `close-offer-tier` with that function's request body):

```ts
Deno.test("open-offer-tier 403s when booking_flow entitlement is off", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: { org_memberships: { data: { role: "producer" } } },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { show_date_id: SD, tier: 1, org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "feature_disabled");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/ supabase/functions/close-offer-tier/`
Expected: FAIL — status is 200, not 403.

- [ ] **Step 3: Write the implementation**

In each `index.ts`, add the import:

```ts
import { requireFeature } from "../_shared/entitlements.ts";
```

and insert the gate immediately after the existing `requireOrgRole` / auth check succeeds and the org id is known, before any booking work:

```ts
  const denied = await requireFeature(deps, orgId, "booking_flow");
  if (denied) return denied;
```

Use whichever local variable already holds the resolved org id in that function; do not re-derive it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/ supabase/functions/close-offer-tier/`
Expected: PASS. Then run the whole suite, because these functions have multiple test files: `deno test --allow-all --node-modules-dir=none supabase/functions/`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/open-offer-tier supabase/functions/close-offer-tier
git commit -m "gate offer tier endpoints on the booking_flow entitlement"
```

---

### Task 6: Filter the crons to entitled orgs

Four crons plus `airtable-poll`. `filterEntitledOrgs` already exists and is a single batched read, not an N+1.

Note `tier-at-risk-watcher` is different: it never calls `getActiveOrgs`. It scans open tiers and derives the org from `show_dates.org_id`, caching the resolved flow per org in `flowByOrg`. Gate it with a per-org entitlement check in the same loop, cached the same way.

**Files:**
- Modify: `supabase/functions/expire-offers/index.ts:47`
- Modify: `supabase/functions/send-offer-digest/index.ts:52`
- Modify: `supabase/functions/send-confirmation-digest/index.ts:96`
- Modify: `supabase/functions/tier-at-risk-watcher/index.ts` (the per-row org gate near line 101)
- Modify: `supabase/functions/airtable-poll/index.ts` (inside the per-org loop, at the tier-1 auto-open)
- Test: the matching `index.di.test.ts` beside each

**Interfaces:**
- Consumes: `filterEntitledOrgs<T extends { id: string }>(admin: SupabaseClient, orgs: T[], feature: FeatureKey): Promise<T[]>`; `checkFeature(admin, orgId, feature): Promise<boolean>` for the per-row watcher case. Both from `../_shared/entitlements.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

One per function. Pattern for `send-offer-digest`:

```ts
Deno.test("send-offer-digest skips orgs without the booking_flow entitlement", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      organizations: { data: [{ id: ORG }] },
      org_entitlements: { data: [{ org_id: ORG, feature: "booking_flow", enabled: false }] },
    },
  });
  const res = await handle(makeRequest({ headers: CRON }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).digests_sent, 0);
  assertEquals(calls.sendEmail.length, 0);
});
```

And the retained fail-open contract, which must stay pinned:

```ts
Deno.test("send-offer-digest keeps every org when the entitlement read errors", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      organizations: { data: [{ id: ORG }] },
      org_entitlements: { data: null, error: { message: "boom" } },
    },
  });
  const res = await handle(makeRequest({ headers: CRON }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).processed_orgs.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/ supabase/functions/expire-offers/ supabase/functions/tier-at-risk-watcher/ supabase/functions/airtable-poll/`
Expected: FAIL — unentitled orgs are still processed.

- [ ] **Step 3: Write the implementation**

Add to each of the four `getActiveOrgs` callers:

```ts
import { filterEntitledOrgs } from "../_shared/entitlements.ts";
```

`send-offer-digest` (line ~52) and `send-confirmation-digest` (line ~96):

```ts
    orgs = await filterEntitledOrgs(admin, await getActiveOrgs(admin), "booking_flow");
```

`expire-offers` (line ~47) — filtering here closes both passes at once, because `activeOrgIds` is derived from `reminderOrgs` and already gates the escalation scan:

```ts
    reminderOrgs = await filterEntitledOrgs(admin, await getActiveOrgs(admin), "booking_flow");
```

`tier-at-risk-watcher` — add a per-org entitlement cache beside the existing `flowByOrg`, and skip the row when unentitled:

```ts
import { checkFeature } from "../_shared/entitlements.ts";

  // Entitlement cache mirroring flowByOrg: several open tiers in one scan can
  // belong to the same org, and entitlement does not change mid-scan.
  const entitledByOrg = new Map<string, boolean>()
```

then inside the row loop, immediately after `const orgId = sdRow.org_id`:

```ts
    let entitled = entitledByOrg.get(orgId)
    if (entitled === undefined) {
      entitled = await checkFeature(admin, orgId, 'booking_flow')
      entitledByOrg.set(orgId, entitled)
    }
    if (!entitled) continue
```

`airtable-poll` — keep the date sync, skip only the auto-open. Inside the per-org loop, before the tier-1 auto-open call:

```ts
      const bookingEnabled = await checkFeature(admin, org.id, "booking_flow");
```

and guard the existing `openOfferTierBatch(...)` call with `if (bookingEnabled) { … }`.

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS. Run the full suite, not single files — these functions each have several test files and a single-file run has hidden regressions here before.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/expire-offers supabase/functions/send-offer-digest supabase/functions/send-confirmation-digest supabase/functions/tier-at-risk-watcher supabase/functions/airtable-poll
git commit -m "skip unentitled orgs in the booking engine crons"
```

---

### Task 7: Database floor — RESTRICTIVE write policies and the understudy trigger

The highest-risk task. Three new RESTRICTIVE policies close INSERT/UPDATE/DELETE on `bookings` for unentitled orgs without touching the four existing permissive policies, and the understudy trigger stops promoting.

`FOR ALL` must not be used: it would restrict SELECT, and readable confirmed cast depends on SELECT staying open.

**Files:**
- Create: `supabase/migrations/<real-timestamp>_booking_flow_write_gate.sql`
- Create: `supabase/tests/booking_flow_write_gate.sql`

**Interfaces:**
- Consumes: `public.is_feature_enabled(_org uuid, _feature text) returns boolean` (exists, from `20260716233515_org_entitlements.sql`).
- Produces: policies `booking_flow_required_insert`, `booking_flow_required_update`, `booking_flow_required_delete` on `public.bookings`; an updated `public.promote_understudy_on_cancellation()`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/booking_flow_write_gate.sql`:

```sql
begin;
select plan(5);

-- Fixtures: one entitled org, one not.
insert into public.organizations (id, name, status)
values ('11111111-1111-1111-1111-111111111111', 'Entitled', 'active'),
       ('22222222-2222-2222-2222-222222222222', 'Unentitled', 'active');
insert into public.org_entitlements (org_id, feature, enabled)
values ('22222222-2222-2222-2222-222222222222', 'booking_flow', false);

select policy_cmd_is('public', 'bookings', 'booking_flow_required_insert', 'INSERT',
  'insert gate exists');
select policy_cmd_is('public', 'bookings', 'booking_flow_required_update', 'UPDATE',
  'update gate exists');
select policy_cmd_is('public', 'bookings', 'booking_flow_required_delete', 'DELETE',
  'delete gate exists');

-- SELECT must stay open: the confirmed cast has to remain readable.
select is_empty(
  $$ select policyname from pg_policies
     where schemaname='public' and tablename='bookings'
       and permissive='RESTRICTIVE' and cmd='SELECT'
       and policyname like 'booking_flow_required%' $$,
  'no restrictive SELECT gate was added');

-- The understudy trigger no-ops for an unentitled org.
select is(
  public.is_feature_enabled('22222222-2222-2222-2222-222222222222', 'booking_flow'),
  false,
  'unentitled org reports the feature off');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run it through the Supabase MCP `execute_sql`, wrapping the file body:

```sql
BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; <file body without its own begin/rollback> ROLLBACK;
```

Expected: FAIL — the three policies do not exist.

- [ ] **Step 3: Write the migration**

```sql
-- booking_flow becomes a real module: an unentitled org cannot write bookings.
--
-- These are RESTRICTIVE policies, so they compose with AND against the existing
-- permissive policies ("Admins manage bookings", "Producers manage bookings",
-- "Artists can respond to own offers") without this migration having to restate
-- their bodies. Restating them is how a stale copy silently reverts behaviour,
-- which is exactly the trap 20260716235007 had to navigate.
--
-- Deliberately INSERT/UPDATE/DELETE only, never FOR ALL: SELECT must stay open so
-- a producer in an unentitled org can still read who is already confirmed.
--
-- Service-role callers (crons, edge functions) and SECURITY DEFINER triggers
-- bypass RLS, so this binds `authenticated` clients only. Those paths are gated
-- at their own layer.

DROP POLICY IF EXISTS booking_flow_required_insert ON public.bookings;
CREATE POLICY booking_flow_required_insert
ON public.bookings AS RESTRICTIVE FOR INSERT
TO authenticated
WITH CHECK (public.is_feature_enabled(org_id, 'booking_flow'));

DROP POLICY IF EXISTS booking_flow_required_update ON public.bookings;
CREATE POLICY booking_flow_required_update
ON public.bookings AS RESTRICTIVE FOR UPDATE
TO authenticated
USING (public.is_feature_enabled(org_id, 'booking_flow'))
WITH CHECK (public.is_feature_enabled(org_id, 'booking_flow'));

DROP POLICY IF EXISTS booking_flow_required_delete ON public.bookings;
CREATE POLICY booking_flow_required_delete
ON public.bookings AS RESTRICTIVE FOR DELETE
TO authenticated
USING (public.is_feature_enabled(org_id, 'booking_flow'));
```

Then append the trigger change. Copy the **newest** body of `promote_understudy_on_cancellation()` verbatim from `20260716235007_booking_flow_entitlement_gate.sql` and add one early return directly after the `app.cancelling_show_date` guard:

```sql
  -- Module gate: an org without booking_flow has no automation at all. Without
  -- this the function reads get_effective_booking_flow, receives NULL, and
  -- COALESCEs straight back into promoting.
  IF NOT public.is_feature_enabled(NEW.org_id, 'booking_flow') THEN
    RETURN NULL;
  END IF;
```

- [ ] **Step 4: Apply and verify**

Apply via the Supabase MCP `apply_migration` (migrations do **not** auto-apply on merge). Note the real version timestamp it records and name the file in `supabase/migrations/` to match exactly.

Re-run the pgTAP file. Expected: PASS (5 tests).

Then verify the flagged risk from spec §4 — that the paths which legitimately write bookings are not caught by the new floor.

Show-date cancellation does **not** write `bookings` directly: `cancelShowDate` (`src/data/showDates.ts:43`) is a plain client UPDATE on `show_dates`, and the cascade to bookings happens in the `cascade_cancel_bookings_on_date_cancel` trigger. That trigger, `delete_org` and `anonymize_user` were all confirmed `SECURITY DEFINER` while this plan was written, so they bypass RLS and are unaffected. Re-confirm after applying, since the check is cheap and the whole risk rests on it:

```sql
select proname, prosecdef from pg_proc
where proname in ('delete_org','anonymize_user','cascade_cancel_bookings_on_date_cancel')
order by proname;
```

Expected: `prosecdef` is `true` for all three. If any is `false`, stop and report — that path would break for unentitled orgs and the plan needs revisiting.

Then prove it end to end rather than by inference, inside a transaction you roll back: with an unentitled org, cancel one of its show dates and confirm its bookings still moved to `cancelled`.

```sql
begin;
insert into public.org_entitlements (org_id, feature, enabled)
values ('<test org id>', 'booking_flow', false)
on conflict (org_id, feature) do update set enabled = false;
update public.show_dates set status = 'cancelled' where id = '<test show_date id>';
select status, count(*) from public.bookings where show_date_id = '<test show_date id>' group by status;
rollback;
```

Expected: the bookings show `cancelled`. If they did not change, the cascade is being blocked and Task 7 must be revised before merging.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/booking_flow_write_gate.sql
git commit -m "require the booking_flow entitlement for booking writes"
```

---

### Task 8: System map, docs, and full verification

Automation behaviour changed in Tasks 5-7, so the system map must move with it in the same PR.

**Files:**
- Modify: `docs/system-map.md`
- Modify: `src/data/systemMap.ts`
- Modify: `docs/adr/README.md` (key-decisions summary entry for the module gate)

- [ ] **Step 1: Update the system map**

In both `docs/system-map.md` and `src/data/systemMap.ts`, add the entitlement gate to each affected node: `open-offer-tier`, `close-offer-tier`, `expire-offers`, `send-offer-digest`, `send-confirmation-digest`, `tier-at-risk-watcher`, `airtable-poll`'s auto-open, and `promote_understudy_on_cancellation`. Each gains a note of the form "gated on the `booking_flow` entitlement". Keep the two files consistent with each other; they describe the same graph.

- [ ] **Step 2: Record the decision**

Add a line to the "Key decisions (operational summary)" section of `docs/adr/README.md` stating that `booking_flow` is a full module gated at RLS, edge and UI, that disabling it freezes rather than drains data, and that `checkFeature` deliberately fails open for it.

- [ ] **Step 3: Run every gate**

```bash
npm run lint
```

```bash
npm run test:coverage
```

```bash
npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit
```

```bash
deno check --node-modules-dir=none supabase/functions/*/index.ts
```

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

```bash
npm run sync:mirrors:check
```

Expected: all pass. `sync:mirrors:check` should report no drift — this plan does not change the entitlements registry, so if it reports drift, something was hand-edited in a generated target.

- [ ] **Step 4: Commit**

```bash
git add docs/system-map.md src/data/systemMap.ts docs/adr/README.md
git commit -m "document the booking_flow module gate in the system map"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 RESTRICTIVE write policies, SELECT open | 7 |
| §1 understudy trigger early return | 7 |
| §2 `requireFeature` on both offer-tier functions | 5 |
| §2 four crons + `airtable-poll` | 6 |
| §2 retained fail-open for `booking_flow` | 6 (pinned by test) |
| §3 nav lock + `ROUTE_FEATURES` | 2 |
| §3 `ModuleGate` | 1 |
| §3 five gated surfaces | 3 (sheet), 4 (dashboards, artist bookings) |
| §3 badge suppression | 2 |
| §3 `BookingFlowTab` copy | 2 |
| §4 Vitest / Deno / pgTAP coverage | 1-7 |
| §4 flagged `SECURITY DEFINER` risk | 7 step 4 |
| §5 out of scope respected | no task touches `hire_orders` or entitlement defaults |

No gaps.

**Type consistency:** `ModuleGate({ feature, children, preview })` is defined in Task 1 and consumed with exactly those prop names in Tasks 3 and 4. `filterEntitledOrgs(admin, orgs, feature)` and `checkFeature(admin, orgId, feature)` match the real signatures in `_shared/entitlements.ts`. `BookingCardSection({ bookings, children })` and `ProducerBookingSection({ children })` are each defined and consumed within their own task.

**Verified while planning, so the implementer does not have to:**
- `policy_cmd_is` is a real pgTAP assertion and is available on this project.
- `delete_org`, `anonymize_user` and `cascade_cancel_bookings_on_date_cancel` are all `SECURITY DEFINER`, so spec §4's flagged risk is expected to be clean. Task 7 still proves it at runtime rather than resting on that.
- `bookings` has exactly four permissive policies plus the RESTRICTIVE `org_isolation`, which is why Task 7 can add restrictive policies instead of restating any existing body.

**Open item for the implementer:** Task 4 describes the `ArtistDashboard` and `ArtistBookingsView` wrap points in prose rather than exact line numbers, because both files have several booking regions and the right seam depends on what the file looks like at that moment. Wrap the offers/bookings region and leave hire-orders outside the gate.
