import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useGetRunningV3 } from "./useGetRunningV3";

const ORG_ID = "org-1";
const TEST_ORG = { id: ORG_ID, name: "Test Org", slug: "test-org", status: "active", is_demo: false };

/** A fully entitled, fully configured org: every table read this hook's chain of hooks
 *  touches resolves without error. Mirrors `useGetRunning.test.tsx`'s `fullySeeded()`, plus
 *  a `skills` row so the v3-only `skillsDone` best-effort signal resolves true. Individual
 *  `done` values beyond `skillsDone` are not asserted here (that's `steps.test.ts`'s job) —
 *  this seed only needs to make every query settle so `isLoading` can flip to false. */
function fullySeeded() {
  seed({
    org_entitlements: {
      data: [
        { feature: "booking_flow", enabled: true },
        { feature: "hire_orders", enabled: true },
      ],
      error: null,
    },
    app_settings: {
      data: [{ key: "booking_flow", org_id: ORG_ID, value: { active: true } }],
      error: null,
    },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    artists: { data: null, error: null, count: 0 },
    org_memberships: { data: null, error: null, count: 2 },
    skills: { data: [{ id: "skill-1", name: "Lead" }], error: null },
  });
}

beforeEach(() => fullySeeded());

describe("useGetRunningV3", () => {
  it("returns a 16-step model for an admin with both modules on", async () => {
    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.model).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.model).not.toBeNull();
    expect(result.current.model!.totalCount).toBe(16);
    expect(result.current.model!.bookingOn).toBe(true);
    expect(result.current.model!.hireOrdersOn).toBe(true);
  });

  it("reports totalCount 0 for an org entitled to neither module", async () => {
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: false },
          { feature: "hire_orders", enabled: false },
        ],
        error: null,
      },
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
      org_memberships: { data: null, error: null, count: 0 },
      skills: { data: [], error: null },
    });

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.model!.totalCount).toBe(0);
    expect(result.current.model!.bookingOn).toBe(false);
    expect(result.current.model!.hireOrdersOn).toBe(false);
  });

  it("does not read booking/hire-order setup status for an artist (defensive gate)", async () => {
    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["artist"],
        hasRole: (r) => r === "artist",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const calls = (client.calls ?? []) as { table: string }[];
    expect(calls.some((c) => c.table === "shows")).toBe(false);
    expect(calls.some((c) => c.table === "app_settings")).toBe(false);
  });
});
