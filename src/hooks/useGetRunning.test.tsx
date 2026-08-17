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

import { useGetRunning } from "./useGetRunning";

const ORG_ID = "org-1";
const TEST_ORG = { id: ORG_ID, name: "Test Org", slug: "test-org", status: "active", is_demo: false };

/** A fully entitled, fully configured org: every table read this hook's chain of
 *  hooks touches resolves without error. Individual `done` values are not asserted
 *  here (they are the composer's own job, covered by tasks.test.ts) — this seed only
 *  needs to make every query settle so `isLoading` can flip to false. */
function fullySeeded() {
  seed({
    org_entitlements: {
      data: [
        { feature: "booking_flow", enabled: true },
        { feature: "hire_orders", enabled: true },
      ],
      error: null,
    },
    // A single non-empty row set: this fake does not filter a single-object seed by a
    // plain `.eq()` (only `.in()`/`.ilike()` narrow it — see supabaseFake.ts), so every
    // app_settings-backed read (fetchOwnedSettingKeys, fetchBookingFlow's
    // resolveOrgSetting, useOrgLetterhead, useOrgTerms, hasOrgSettingRow) resolves to
    // this same row set rather than genuinely per-key data. That's enough for every
    // read to settle without error; the individual step `done` values it produces are
    // not what this test is pinning.
    app_settings: {
      data: [{ key: "booking_flow", org_id: ORG_ID, value: { active: true } }],
      error: null,
    },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    artists: { data: null, error: null, count: 0 },
    org_memberships: { data: null, error: null, count: 0 },
  });
}

beforeEach(() => fullySeeded());

describe("useGetRunning", () => {
  it("composes an 11-task model for an admin in a fully entitled org", async () => {
    const { result } = renderHookWithProviders(() => useGetRunning(), {
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
    expect(result.current.model!.totalCount).toBe(11);
    expect(result.current.model!.bookingOn).toBe(true);
    expect(result.current.model!.hireOrdersOn).toBe(true);
  });

  it("stays loading (model null) until entitlements and both module reads settle", () => {
    const { result } = renderHookWithProviders(() => useGetRunning(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.model).toBeNull();
  });

  it("reports totalCount 0 for an org entitled to neither module (no reads gated on)", async () => {
    // booking_flow defaults ON in the registry (FEATURE_REGISTRY), so an empty
    // org_entitlements set would still compose the booking phases — explicitly turn
    // both off to exercise the true "neither module" case.
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
    });

    const { result } = renderHookWithProviders(() => useGetRunning(), {
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
    const { result } = renderHookWithProviders(() => useGetRunning(), {
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
