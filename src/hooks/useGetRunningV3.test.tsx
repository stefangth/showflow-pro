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
 *  a `skills` row so the skill-eligibility-gaps read settles cleanly. Individual `done`
 *  values beyond that (including `skillGaps`) are not asserted here, that is
 *  `steps.test.ts`'s job. This seed only needs to make every query settle so `isLoading`
 *  can flip to false. */
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

  it("returns model null and isLoading false immediately when inactive, and reads nothing", async () => {
    const { result } = renderHookWithProviders(() => useGetRunningV3({ active: false }), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    // No loading window: an inactive call never fetches, so it settles synchronously.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.model).toBeNull();
    const calls = (client.calls ?? []) as { table: string }[];
    expect(calls.some((c) => c.table === "shows")).toBe(false);
    expect(calls.some((c) => c.table === "app_settings")).toBe(false);
    expect(calls.some((c) => c.table === "skills")).toBe(false);
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

  it("wires real fee/document done from owned hire-order setting rows", async () => {
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: true },
          { feature: "hire_orders", enabled: true },
        ],
        error: null,
      },
      app_settings: {
        data: [
          { key: "booking_flow", org_id: ORG_ID, value: { active: true } },
          { key: "hire_order_defaults", org_id: ORG_ID, value: {} },
        ],
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

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const paper = result.current.model!.phases.find((p) => p.key === "paperwork")!;
    expect(paper.steps.find((s) => s.key === "fee")!.done).toBe(true);
    expect(paper.steps.find((s) => s.key === "document")!.done).toBe(false);
  });

  it("does not report the skills step done when the gaps read errors out", async () => {
    // An unreadable show_required_skills read (e.g. an RLS misconfiguration) must not be
    // mistaken for "no gaps": skillGaps.data stays undefined forever, so a naive
    // `data?.length ?? 0` would falsely report the step done. Fail closed instead.
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
      show_required_skills: { data: null, error: new Error("permission denied") },
    });

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => {
      const bookable = result.current.model!.phases.find((p) => p.key === "bookable")!;
      expect(bookable.steps.find((s) => s.key === "skills")!.done).toBe(false);
    });
  });

  /**
   * `skillGaps` is deliberately outside the board's isLoading gate, so the board renders
   * while that query is still in flight. Resolving the in-flight window to 0 marked the
   * `skills` step done on every mount, and for an otherwise-finished org flipped
   * `model.complete` true long enough to flash the retired "Everything here is set up"
   * board before the gaps landed.
   */
  it("does not report the skills step done while the gaps read is still in flight", async () => {
    let releaseGaps: (() => void) | null = null;
    const gapsGate = new Promise<void>((resolve) => {
      releaseGaps = resolve;
    });
    fullySeeded();
    const realFrom = client.from as (t: string) => unknown;
    client.from = (table: string) => {
      const builder = realFrom(table) as PromiseLike<unknown> & Record<string, unknown>;
      // Hold ONLY the gaps read (show_required_skills) open; every other query settles.
      if (table !== "show_required_skills") return builder;
      const then = builder.then.bind(builder) as PromiseLike<unknown>["then"];
      builder.then = ((onOk: never, onErr: never) =>
        gapsGate.then(() => then(onOk, onErr))) as PromiseLike<unknown>["then"];
      return builder;
    };

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const bookable = result.current.model!.phases.find((p) => p.key === "bookable")!;
    expect(bookable.steps.find((s) => s.key === "skills")!.done).toBe(false);
    expect(result.current.model!.complete).toBe(false);

    releaseGaps!();
  });

  /**
   * `BookingSetupStatus.datesWithoutCity` is `coverage?.futurePairs.filter(...).length ?? 0`,
   * so a FAILED coverage read reports 0 exactly like a clean one. The hook consulted only
   * `isLoading`, so an errored read turned the `cities` step GREEN, counted it toward
   * `canFirstOffer`, and made the "your first ask is shut" card disappear, while the step's
   * own BODY (which does read `statusError`) showed a read error. Unread means outstanding.
   */
  it("does not report the cities step done when the coverage read errors out", async () => {
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: true },
          { feature: "hire_orders", enabled: false },
        ],
        error: null,
      },
      app_settings: {
        data: [{ key: "booking_flow", org_id: ORG_ID, value: { active: true } }],
        error: null,
      },
      shows: { data: [], error: null },
      // The date COUNT read succeeds (the org has dates), so `hasAnyDates` is true and the
      // only thing left that could hold the step open is the failed coverage read.
      show_dates: { data: [], error: null, count: 3 },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      // fetchLadderCoverageInputs reads cast_members last: this is what makes the whole
      // coverage query reject, leaving datesWithoutCity at its fail-open 0.
      cast_members: { data: null, error: new Error("permission denied") },
      artists: { data: null, error: null, count: 3 },
      org_memberships: { data: null, error: null, count: 2 },
      skills: { data: [], error: null },
    });

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => {
      const getDates = result.current.model!.phases.find((p) => p.key === "get_dates")!;
      expect(getDates.steps.find((s) => s.key === "cities")!.done).toBe(false);
    });
    // And the advisory says it does not know, rather than reporting a reassuring 0.
    expect(result.current.model!.datesWithoutCityUnknown).toBe(true);
    expect(result.current.model!.canFirstOffer).toBe(false);
  });
});

describe("useGetRunningV3 dates signals (Phase 2)", () => {
  // datesMapDone reads isDatesMapComplete (Controller Ruling C, Task 8): only `date` and
  // `sub_program` are required, so this fixture deliberately leaves every optional slot
  // (city, venue, the three sessions, the cancellation status field) unmapped — proving the
  // map step is reachable for an org that never fills those in, which the old
  // `mapped >= mappedTotal` definition (all nine slots) made impossible.
  const REQUIRED_MAPPED_FIELD_MAP = { date: "Date", sub_program: "Sub Program" };

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
          { key: "airtable_field_map", org_id: ORG_ID, value: mapped ? REQUIRED_MAPPED_FIELD_MAP : {} },
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

  it("marks connect and map done when the airtable source is connected and the required fields (date + sub_program) are mapped, even with every optional field left unmapped", async () => {
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

  // Fix #3 (efficiency): the Airtable console is only ever consumed by this hook when the
  // dates source is Airtable (datesConnectDone/datesMapDone). For a manual source it must not
  // mount the console at all, so a manual/by-hand org never pays for its ~7 always-on queries
  // (key-status, settings, bases, tables, etc.).
  it("does not read the Airtable console for a manual dates source", async () => {
    seedDatesSignals("manual");

    const { result } = renderHookWithProviders(() => useGetRunningV3(), {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const calls = (client.calls ?? []) as { table: string }[];
    expect(calls.some((c) => c.table === "rpc:get_org_airtable_key_status")).toBe(false);
  });
});

describe("useGetRunningV3 dates signals (sheet source, Task A6)", () => {
  /** Seeds just enough for the hook's whole chain (booking setup + dates source + sheet
   *  import settings) to settle without erroring. Mirrors `seedDatesSignals` above but for
   *  the `sheet` dates source, seeding `sheet_import_settings` instead of the Airtable rows. */
  function seedSheetSignals(opts: { url?: string; mapped?: boolean } = {}) {
    const { url = "https://docs.google.com/spreadsheets/d/abc/pub?output=csv", mapped = true } = opts;
    seed({
      org_entitlements: {
        data: [
          { feature: "booking_flow", enabled: true },
          { feature: "hire_orders", enabled: false },
        ],
        error: null,
      },
      // Array-seed form (matched on the recorded .eq("key", ...) arg) so that
      // fetchDatesSource and fetchSheetImportSettings each resolve their own row instead of
      // both seeing whichever row happens to come first (resolveOrgSetting does not filter
      // by key itself, it relies on the .eq("key", ...) the fake matches against here).
      app_settings: [
        { when: { key: "getrunning_dates_source" }, data: [{ key: "getrunning_dates_source", org_id: ORG_ID, value: "sheet" }] },
        {
          when: { key: "sheet_import_settings" },
          data: [{ key: "sheet_import_settings", org_id: ORG_ID, value: { url, map: mapped ? { program: "Program", date: "Date" } : {} } }],
        },
        { data: [] },
      ],
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
      org_memberships: { data: null, error: null, count: 0 },
      skills: { data: [], error: null },
    });
  }

  it("marks connect and map done when the sheet source has a saved URL and program+date are mapped", async () => {
    seedSheetSignals({ url: "https://docs.google.com/spreadsheets/d/abc/pub?output=csv", mapped: true });

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

  it("reports connect and map as not done for a sheet source with empty settings", async () => {
    seedSheetSignals({ url: "", mapped: false });

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
    expect(connect.done).toBe(false);
    expect(map.hidden).toBeFalsy();
    expect(map.done).toBe(false);
  });
});
