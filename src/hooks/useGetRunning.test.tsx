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

  it("marks the team task done for a PRODUCER viewer when the org has a producer (regression: producerCount was admin-only-gated)", async () => {
    // Same fully-entitled seed as the admin test, but org_memberships reports a
    // non-zero producer count. Before the fix, useProducerCount's `enabled` gate
    // required role === "admin", so a producer viewer never issued this read at
    // all: producerCount stayed null, and composeGetRunning's `team` task
    // (`done: (producerCount ?? 0) > 0`) was permanently false — this assertion
    // would have failed on the pre-fix code regardless of how many producers the
    // org actually has.
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
      // A non-zero producer-role membership count for this org.
      org_memberships: { data: null, error: null, count: 2 },
    });

    const { result } = renderHookWithProviders(() => useGetRunning(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["producer"],
        hasRole: (r) => r === "producer",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.model).not.toBeNull();

    const bookablePhase = result.current.model!.phases.find((p) => p.key === "bookable");
    const teamTask = bookablePhase?.tasks.find((t) => t.key === "team");
    expect(teamTask).toBeDefined();
    expect(teamTask!.done).toBe(true);
  });

  /**
   * `datesWithoutCity` is 0 for a failed coverage read exactly as for a clean one, and the
   * header/retired board render 0 as silence. The v1 board shares both components, so it
   * has to flag the failure too.
   */
  it("flags the null-city advisory unknown when the coverage read fails", async () => {
    fullySeeded();
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: true },
          { feature: "hire_orders", enabled: false },
        ],
        error: null,
      },
      app_settings: { data: [{ key: "booking_flow", org_id: ORG_ID, value: { active: true } }], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      cast_members: { data: null, error: new Error("permission denied") },
      artists: { data: null, error: null, count: 0 },
      org_memberships: { data: null, error: null, count: 0 },
    });

    const { result } = renderHookWithProviders(() => useGetRunning(), {
      authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.model!.datesWithoutCityUnknown).toBe(true));
    expect(result.current.model!.datesWithoutCity).toBe(0);
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
