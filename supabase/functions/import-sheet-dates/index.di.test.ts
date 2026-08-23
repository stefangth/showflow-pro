/**
 * DI tests for import-sheet-dates — the Google Sheet -> show_dates importer edge
 * function. Reduced-scope mirror of airtable-poll's syncOrg: one org, client-parsed
 * rows, resolved against the org catalog by plain (program, sub_program) / city name.
 *
 * Contract:
 *  - OPTIONS -> preflight
 *  - no Bearer -> 401
 *  - wrong role (artist) -> 403 (requireOrgRole producer+admin)
 *  - org lacks booking_flow entitlement -> 403 (requireFeature)
 *  - happy path: resolves show + city, imports, holds an unresolved-city row, opens
 *    tier-1 for the new date (RPC's new_ids used directly)
 *  - no new dates -> no tier opened
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "org-1";

function sheetReq(body: Record<string, unknown>, headers: Record<string, string> = { Authorization: "Bearer jwt" }) {
  return makeRequest({ headers, body });
}

const CATALOG = {
  shows: { data: [{ id: "showC1", program: "Cats", sub_program: "Evening" }], error: null },
  cities: { data: [{ id: "cityB1", name: "Berlin" }], error: null },
  airtable_sync_log: { data: { id: "log-1" }, error: null },
};

Deno.test("import-sheet-dates DI: OPTIONS -> preflight (204)", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status, 204);
});

Deno.test("import-sheet-dates DI: no Authorization -> 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(sheetReq({ org_id: ORG, rows: [] }, {}), deps);
  assertEquals(res.status, 401);
});

Deno.test("import-sheet-dates DI: rows not an array -> 400", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(sheetReq({ org_id: ORG, rows: {} }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "rows must be an array");
});

Deno.test("import-sheet-dates DI: wrong role (artist) -> 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "artist" }, error: null } },
  });
  const res = await handle(sheetReq({ org_id: ORG, rows: [] }), deps);
  assertEquals(res.status, 403);
});

Deno.test("import-sheet-dates DI: feature off -> 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null } },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  const res = await handle(sheetReq({ org_id: ORG, rows: [] }), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "feature_disabled");
});

Deno.test("import-sheet-dates DI: resolves show + city, imports, holds unresolved city, opens tier-1", async () => {
  const rows = [
    {
      program: "Cats", subProgram: "Evening", date: "2026-09-01", city: "Berlin",
      session_1: "19:30", session_2: null, session_3: null, venue: "Big Top", rowIndex: 1,
    },
    {
      program: "Cats", subProgram: "Evening", date: "2026-09-02", city: "Paris",
      session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 2,
    },
  ];

  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      ...CATALOG,
      show_dates: { data: [{ id: "sd-1", show_id: "showC1", date: "2026-09-01" }], error: null },
    },
    rpcs: {
      import_sheet_dates: { data: { new_count: 1, updated_count: 0, new_ids: ["sd-1"] }, error: null },
    },
  });

  const syncLogInserts: unknown[] = [];
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const resBody = await res.json();
  assertEquals(resBody, { processed: 2, new_dates: 1, updated: 0, held: 1, tiers_opened: 1 });

  // The RPC got exactly the ONE resolved row (Paris held out).
  const rpcCalls = calls.filter((c) => c.table === "rpc:import_sheet_dates").map((c) => c.args[0]);
  assertEquals(rpcCalls.length, 1);
  const rpcArgs = rpcCalls[0] as { p_org: string; p_rows: Array<{ show_id: string; date: string; city_id: string | null }> };
  assertEquals(rpcArgs.p_org, ORG);
  assertEquals(rpcArgs.p_rows.length, 1);
  assertEquals(rpcArgs.p_rows[0].show_id, "showC1");
  assertEquals(rpcArgs.p_rows[0].date, "2026-09-01");
  assertEquals(rpcArgs.p_rows[0].city_id, "cityB1");

  // sync_log: sheet_import
  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.sync_type, "sheet_import");
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.held_count, 1);
  assertEquals(logRow.new_count, 1);
  // imported_count reflects rows actually written (new + updated), not resolved rows sent to the RPC.
  assertEquals(logRow.imported_count, 1);

  // record_log: one imported_new + one held_unresolved
  assertEquals(recordLogInserts.length, 1);
  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(recordRows.length, 2);
  const heldRow = recordRows.find((r) => r.action === "held_unresolved");
  assertExists(heldRow);
  assertEquals(heldRow!.reason, "city 'Paris' not linked");
  const importedRow = recordRows.find((r) => r.action === "imported_new");
  assertExists(importedRow);
  assertEquals(importedRow!.show_date_id, "sd-1");

  // open-offer-tier invoked once with { show_date_id: "sd-1", tier: 1 }.
  assertEquals(invokeCalls.length, 1);
  assertEquals(invokeCalls[0].name, "open-offer-tier");
  assertEquals(invokeCalls[0].body, { show_date_id: "sd-1", tier: 1 });
});

Deno.test("import-sheet-dates DI: missing date -> held with 'missing date'", async () => {
  const rows = [
    { program: "Cats", subProgram: "Evening", date: "", city: "Berlin", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 1 },
  ];
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null }, ...CATALOG },
  });
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });
  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { processed: 1, new_dates: 0, updated: 0, held: 1, tiers_opened: 0 });
  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(recordRows[0].reason, "missing date");
});

Deno.test("import-sheet-dates DI: unresolved program -> held", async () => {
  const rows = [
    { program: "Dogs", subProgram: "Matinee", date: "2026-09-01", city: "", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 1 },
  ];
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null }, ...CATALOG },
  });
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });
  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  const body = await res.json();
  assertEquals(body, { processed: 1, new_dates: 0, updated: 0, held: 1, tiers_opened: 0 });
  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  // Reason names the production (program / sub-program), never the bare sub-program alone.
  assertEquals(recordRows[0].reason, "program 'Dogs / Matinee' not linked");
});

Deno.test("import-sheet-dates DI: invalid date -> held, not sent to RPC, no 500", async () => {
  const rows = [
    { program: "Cats", subProgram: "Evening", date: "13.01.2026", city: "Berlin", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 1 },
  ];
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null }, ...CATALOG },
  });
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });
  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { processed: 1, new_dates: 0, updated: 0, held: 1, tiers_opened: 0 });
  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(recordRows[0].reason, "invalid date '13.01.2026'");
  // Never sent to the RPC.
  const rpcCalls = calls.filter((c) => c.table === "rpc:import_sheet_dates");
  assertEquals(rpcCalls.length, 0);
});

Deno.test("import-sheet-dates DI: calendar-invalid date (2026-02-30) -> held, not sent to RPC, no 500", async () => {
  // Matches the ISO regex and parses via Date.parse (which silently rolls over to
  // 2026-03-02), but is not a real calendar date. Must be caught by the strict round-trip.
  const rows = [
    { program: "Cats", subProgram: "Evening", date: "2026-02-30", city: "Berlin", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 1 },
  ];
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null }, ...CATALOG },
  });
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });
  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { processed: 1, new_dates: 0, updated: 0, held: 1, tiers_opened: 0 });
  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(recordRows[0].reason, "invalid date '2026-02-30'");
  // Never sent to the RPC.
  const rpcCalls = calls.filter((c) => c.table === "rpc:import_sheet_dates");
  assertEquals(rpcCalls.length, 0);
});

Deno.test("import-sheet-dates DI: unresolved city on an existing sheet date does not hold (updates); on a new date, holds", async () => {
  const rows = [
    // Existing sheet date (show_dates seed below has showC1/2026-09-01, source=sheet) re-imported with an unresolved city.
    { program: "Cats", subProgram: "Evening", date: "2026-09-01", city: "Paris", session_1: "20:00", session_2: null, session_3: null, venue: null, rowIndex: 1 },
    // A brand-new date with an unresolved city.
    { program: "Cats", subProgram: "Evening", date: "2026-09-05", city: "Paris", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 2 },
  ];
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      ...CATALOG,
      show_dates: { data: [{ id: "sd-1", show_id: "showC1", date: "2026-09-01" }], error: null },
    },
    rpcs: {
      import_sheet_dates: { data: { new_count: 0, updated_count: 1, new_ids: [] }, error: null },
    },
  });
  const recordLogInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Existing 2026-09-01 row goes through (not held) and updates; the new 2026-09-05 row is held.
  assertEquals(body, { processed: 2, new_dates: 0, updated: 1, held: 1, tiers_opened: 0 });

  const rpcCalls = calls.filter((c) => c.table === "rpc:import_sheet_dates").map((c) => c.args[0]);
  assertEquals(rpcCalls.length, 1);
  const rpcArgs = rpcCalls[0] as { p_rows: Array<{ show_id: string; date: string; city_id: string | null }> };
  assertEquals(rpcArgs.p_rows.length, 1);
  assertEquals(rpcArgs.p_rows[0].date, "2026-09-01");
  assertEquals(rpcArgs.p_rows[0].city_id, null);

  const recordRows = recordLogInserts[0] as Array<Record<string, unknown>>;
  const heldRow = recordRows.find((r) => r.action === "held_unresolved");
  assertExists(heldRow);
  assertEquals(heldRow!.reason, "city 'Paris' not linked");
  assertEquals((heldRow!.raw_fields as { date?: string }).date, "2026-09-05");
});

Deno.test("import-sheet-dates DI: no new dates -> no tier opened", async () => {
  const rows = [
    { program: "Cats", subProgram: "Evening", date: "2026-09-01", city: "", session_1: null, session_2: null, session_3: null, venue: null, rowIndex: 1 },
  ];
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      ...CATALOG,
      show_dates: { data: [{ id: "sd-2", show_id: "showC1", date: "2026-09-01" }], error: null },
    },
    rpcs: {
      import_sheet_dates: { data: { new_count: 0, updated_count: 1, new_ids: [] }, error: null },
    },
  });
  const res = await handle(sheetReq({ org_id: ORG, rows }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { processed: 1, new_dates: 0, updated: 1, held: 0, tiers_opened: 0 });
  assertEquals(invokeCalls.length, 0);
});
