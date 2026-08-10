import { it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Test Org" }, hasRole: (r: string) => r === "admin" }),
}));
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useModuleOnboardingRail } from "./useModuleOnboardingRail";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus as computeHireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * How many steps the booking module actually has, straight from the engine that composes
 * this rail, for the never-configured org the `beforeEach` seed describes.
 *
 * Not a literal: these assertions exist to prove the rail reports whatever
 * `computeBookingSetupStatus` reports, and a hardcoded count turns "the rail agrees with the
 * engine" into "the rail agrees with a number a test author typed", which then needs one
 * edit per call site the next time a step is added. `useDashboardFirstRun.test.tsx` pins its
 * own "0 of N" the same way.
 */
const BOOKING_STEPS = computeBookingSetupStatus({
  flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
  coverage: null, artistCount: 0, artistAcceptance: null,
}).steps.length;

/** The same derivation for the sibling module, for the same reason. */
const HIRE_ORDER_STEPS = computeHireOrderSetupStatus({
  letterhead: null, terms: null, countersignChosen: false,
}).steps.length;

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    // Head count, so the seed carries `count` rather than rows (see fetchArtistCount).
    artists: { data: null, error: null, count: 0 },
  });
});

it("composes the booking module with its header copy and progress totals", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("booking_flow", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(BOOKING_STEPS));
  expect(result.current.title).toBe("Get bookings running");
  expect(result.current.steps).toHaveLength(BOOKING_STEPS);
  expect(result.current.progressFilled).toBe(0);
  expect(result.current.progressLabel).toContain(`of ${BOOKING_STEPS}`);
});

it("composes the hire-orders module with its header copy and its own steps", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(HIRE_ORDER_STEPS));
  expect(result.current.title).toBe("Get hire orders ready");
  expect(result.current.steps).toHaveLength(HIRE_ORDER_STEPS);
  expect(result.current.steps.map((s) => s.moduleKey)).toEqual(
    Array.from({ length: HIRE_ORDER_STEPS }, () => "hire_orders"),
  );
});

it("gives an editor the action-framed module header", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("booking_flow", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(BOOKING_STEPS));
  expect(result.current.eyebrow).toBe("Set up");
  // Flow-neutral by design: this banner has no ctx, so the same sentence reaches a
  // direct-book org that never opens a tier (see bookingOnboarding.railHeader).
  expect(result.current.body).toBe("Dates keep syncing and you can edit them now. These are what the first booking needs.");
});

it("explains, for a viewer who cannot edit, that an admin finishes the setup", async () => {
  canRef.value = false;
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(3));
  expect(result.current.eyebrow).toBe("Org setup");
  expect(result.current.body).toMatch(/only an admin/i);
  // Progress label follows the same role-aware word as the eyebrow (no "Org setup" on the
  // left with "Set up · N of M" on the right).
  expect(result.current.progressLabel).toMatch(/^Org setup · \d+ of 3$/);
});

it("never surfaces a sibling module's off-state footer (the scoped module is always entitled here)", async () => {
  // composeOnboarding derives offFooters from every feature NOT in `enabled`; a
  // single-module set would otherwise always report the sibling module "off".
  const booking = renderHook(() => useModuleOnboardingRail("booking_flow", "org-1"), { wrapper });
  await waitFor(() => expect(booking.result.current.progressTotal).toBe(BOOKING_STEPS));
  expect(booking.result.current.offFooters).toEqual([]);

  const hire = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(hire.result.current.progressTotal).toBe(3));
  expect(hire.result.current.offFooters).toEqual([]);
});

it("is 'banner' by default and passes the mode through", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("banner"));
});

it("collapses to a bar when dismissed, exposing progress copy and an expand() that re-expands", async () => {
  localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  expect(result.current.collapsedLabel).toBe("Set up in progress");
  expect(result.current.collapsedHint).toBe("3 steps left");
  expect(result.current.collapsedCta).toBe("Resume");
  act(() => result.current.expand());
  await waitFor(() => expect(result.current.mode).toBe("banner"));
});

it("labels the collapsed bar 'Org setup' for a viewer who cannot edit", async () => {
  canRef.value = false;
  localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  expect(result.current.collapsedLabel).toBe("Org setup in progress");
});
