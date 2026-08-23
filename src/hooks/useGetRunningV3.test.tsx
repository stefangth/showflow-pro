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

describe("useGetRunningV3 dates signals (Phase 2)", () => {
  // All nine slots requiredMappedCount() checks, so a fully-mapped fixture reads
  // mapped === mappedTotal.
  const FULLY_MAPPED_FIELD_MAP = {
    date: "Date", program: "Program", sub_program: "Sub Program", city: "City", venue: "Venue",
    session_1: "Session 1", session_2: "Session 2", session_3: "Session 3", status_field: "Status",
  };

  /** Seeds just enough for the hook's whole chain (booking setup + dates source + Airtable
   *  console) to settle without erroring. Only the dates-source / Airtable-console rows are
   *  varied per test; every other read falls back to the fake's empty-table default. */
  function seedDatesSignals(source: "airtable" | "manual", opts: { connected?: boolean; mapped?: boolean } = {}) {
    const { connected = true, mapped = true } = opts;
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: true },
          { feature: "hire_orders", enabled: false },
        ],
        error: null,
      },
      // NOTE: the fake does not filter rows by `.eq("key", ...)` (only `.in()`/`.ilike()`
      // narrow a single-object seed), so every resolveOrgSetting-based read of this table
      // (fetchDatesSource, fetchBookingFlow) receives this whole array and picks its first
      // org-scoped row. Ordering the dates-source row first is what makes fetchDatesSource
      // resolve correctly here; fetchBookingFlow reading the same row as "booking_flow" is
      // harmless (normalizeBookingFlow degrades a non-object value to defaults).
      app_settings: {
        data: [
          { key: "getrunning_dates_source", org_id: ORG_ID, value: source },
          { key: "airtable_base_id", org_id: ORG_ID, value: "base1" },
          { key: "airtable_table_name", org_id: ORG_ID, value: "Dates" },
          { key: "airtable_field_map", org_id: ORG_ID, value: mapped ? FULLY_MAPPED_FIELD_MAP : {} },
        ],
        error: null,
      },
      "rpc:get_org_airtable_key_status": { data: { present: connected, updated_at: null }, error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
      org_memberships: { data: null, error: null, count: 0 },
      skills: { data: [], error: null },
    });
  }

  it("marks connect and map done when the airtable source is connected and fully mapped", async () => {
    seedDatesSignals("airtable", { connected: true, mapped: true });

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const getDates = result.current.model!.phases.find((p) => p.key === "get_dates")!;
    const connect = getDates.steps.find((s) => s.key === "connect")!;
    const map = getDates.steps.find((s) => s.key === "map")!;
    expect(connect.hidden).toBeFalsy();
    expect(connect.done).toBe(true);
    expect(map.hidden).toBeFalsy();
    expect(map.done).toBe(true);
  });

  it("hides connect and map for a manual dates source", async () => {
    seedDatesSignals("manual");

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const getDates = result.current.model!.phases.find((p) => p.key === "get_dates")!;
    const connect = getDates.steps.find((s) => s.key === "connect")!;
    const map = getDates.steps.find((s) => s.key === "map")!;
    expect(connect.hidden).toBe(true);
    expect(map.hidden).toBe(true);
  });
});
