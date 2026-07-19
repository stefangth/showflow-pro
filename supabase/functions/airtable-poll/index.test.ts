/**
 * Contract tests for the airtable-poll edge function.
 *
 * These exercise the REAL `handle` (no re-implemented model) against the
 * field-map/key contract: resolution is driven by app_settings.airtable_field_map +
 * the catalog-link keys (shows.airtable_program_key, cities.airtable_city_key), and the
 * outcome vocabulary is imported_new / updated / held_unresolved (no "skipped").
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { bindFakeFrom, type FakeChain, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000c1";

const FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City" };

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Seed an enabled+keyed ORG with one linked show + city, plus the log/notify tables. */
function seededDeps(records: unknown[], fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-magic", airtable_program_key: "Magic" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: fetchImpl ?? (() => Promise.resolve(airtableResponse(records)) as Promise<Response>),
  });
}

const authReq = () => makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });

Deno.test("airtable-poll contract: disabled flag short-circuits — org not synced", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
  });
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.orgs_synced, 0);
});

Deno.test("airtable-poll contract: key-linked records import; missing-date / unlinked-program records are held", async () => {
  const insertedPayloads: unknown[] = [];
  const records = [
    // linked program key "Magic" + linked city "Berlin" → imported_new
    { id: "rec-new-1", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } },
    // missing date → held_unresolved
    { id: "rec-missing-date", fields: { SubProgram: "Magic" } },
    // unlinked program key → held_unresolved
    { id: "rec-unlinked", fields: { Date: "2026-06-02", SubProgram: "NotLinked" } },
  ];

  const { deps } = seededDeps(records);
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        insertedPayloads.push(p);
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // Only the key-linked record imports; the other two are held (not "skipped").
  assertEquals(insertedPayloads.length, 1);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.show_id, "show-magic");
  assertEquals(payload.city_id, "city-berlin");
  assertEquals(payload.airtable_record_id, "rec-new-1");
  assertEquals(body.orgs_synced, 1);
  assertEquals(body.new_dates, 1);
  assertEquals(body.held, 2);
});

/** Seed an enabled+keyed ORG that already has one existing show_date (by airtable_record_id),
 *  so the poll takes the UPDATE branch. `existingStatus` seeds that row's current status. */
function seededDepsWithExisting(
  records: unknown[],
  existing: { airtable_record_id: string; id: string; status: string },
  fieldMap: Record<string, unknown>,
) {
  return makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: fieldMap }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-magic", airtable_program_key: "Magic" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [{ id: existing.id, airtable_record_id: existing.airtable_record_id, status: existing.status }], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: (() => Promise.resolve(airtableResponse(records)) as Promise<Response>),
  });
}

/** Wrap deps.admin.from so every show_dates UPDATE payload is captured for assertion. */
function captureShowDateUpdates(deps: ReturnType<typeof makeFakeDeps>["deps"]): unknown[] {
  const updatePayloads: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => {
        updatePayloads.push(payload);
        return (originalUpdate as (x: unknown) => ReturnType<typeof originalUpdate>)(payload);
      };
    }
    return chain;
  });
  return updatePayloads;
}

const CANCEL_FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City", status_field: "Status", cancelled_value: "Cancelled", cancellation_reason_field: "Reason" };

Deno.test("airtable-poll cancellation: existing date whose Status='Cancelled' updates to cancelled with reason", async () => {
  const records = [{ id: "rec-existing", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", Status: "Cancelled", Reason: "Venue flooded" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "rec-existing", id: "sd-existing", status: "open" }, CANCEL_FIELD_MAP);
  const updatePayloads = captureShowDateUpdates(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  assertEquals(updatePayloads.length, 1);
  const payload = updatePayloads[0] as Record<string, unknown>;
  assertEquals(payload.status, "cancelled");
  assertEquals(payload.cancellation_reason, "Venue flooded");
});

Deno.test("airtable-poll cancellation: previously-cancelled date that is no longer cancelled revives to open", async () => {
  const records = [{ id: "rec-existing", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", Status: "Confirmed" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "rec-existing", id: "sd-existing", status: "cancelled" }, CANCEL_FIELD_MAP);
  const updatePayloads = captureShowDateUpdates(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  assertEquals(updatePayloads.length, 1);
  const payload = updatePayloads[0] as Record<string, unknown>;
  assertEquals(payload.status, "open");
  assertEquals(payload.cancellation_reason, null);
});

Deno.test("airtable-poll cancellation: existing non-cancelled date staying non-cancelled has no status key", async () => {
  const records = [{ id: "rec-existing", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", Status: "Confirmed" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "rec-existing", id: "sd-existing", status: "open" }, CANCEL_FIELD_MAP);
  const updatePayloads = captureShowDateUpdates(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  assertEquals(updatePayloads.length, 1);
  const payload = updatePayloads[0] as Record<string, unknown>;
  assertEquals("status" in payload, false);
  assertEquals("cancellation_reason" in payload, false);
});

Deno.test("airtable-poll contract: missing cron secret is unauthorized", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }] },
  });
  const res = await handle(makeRequest({ method: "POST" }), deps);
  assertEquals(res.status, 401);
});

const SESSION_FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City", session_1: "S1", session_2: "S2", session_3: "S3" };

/** Wrap deps.admin.from so every show_dates INSERT payload is captured. */
function captureShowDateInserts(deps: ReturnType<typeof makeFakeDeps>["deps"]): unknown[] {
  const inserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        inserts.push(payload);
        const insertChain = originalInsert(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });
  return inserts;
}

Deno.test("airtable-poll sessions: a mapped-but-emptied session clears the column to null", async () => {
  // Existing date; Airtable keeps S1 but clears S2 (was set). The UPDATE must write session_2: null.
  const records = [{ id: "rec-x", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", S1: "19:00" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "rec-x", id: "sd-x", status: "open" }, SESSION_FIELD_MAP);
  const updates = captureShowDateUpdates(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const payload = updates[0] as Record<string, unknown>;
  assertEquals(payload.session_1, "19:00");
  assertEquals(payload.session_2, null); // mapped slot, empty Airtable cell → cleared
  assertEquals(payload.session_3, null);
});

Deno.test("airtable-poll sessions: a brand-new date with no S1 inserts session_1 null (no 00:00 fabrication)", async () => {
  const records = [{ id: "rec-new", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } }];
  const { deps } = seededDepsWithExisting(records, { airtable_record_id: "other", id: "sd-other", status: "open" }, SESSION_FIELD_MAP);
  const inserts = captureShowDateInserts(deps);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const payload = inserts[0] as Record<string, unknown>;
  assertEquals(payload.session_1, null);
});

// ─── Program composite grain (Task 1) ───────────────────────────────────────────
const PROGRAM_FIELD_MAP = { date: "Date", program: "Program", sub_program: "SubProgram", city: "City" };

/** Seed an enabled+keyed ORG with a caller-supplied `shows` array and PROGRAM_FIELD_MAP. */
function seededDepsShows(records: unknown[], shows: unknown[]) {
  return makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: PROGRAM_FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: shows, error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: (() => Promise.resolve(airtableResponse(records)) as Promise<Response>),
  });
}

/** Capture `shows` UPDATE payloads and `show_dates` INSERT payloads in one from() wrapper. */
function captureWrites(deps: ReturnType<typeof makeFakeDeps>["deps"]) {
  const showUpdates: unknown[] = [];
  const showDateInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "shows") {
      const origUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => { showUpdates.push(payload); return origUpdate(payload); };
    }
    if (table === "show_dates") {
      const origInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        showDateInserts.push(payload);
        const insertChain = origInsert(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });
  return { showUpdates, showDateInserts };
}

Deno.test("airtable-poll grain: composite-keyed show resolves; program matches → no shows write", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: "BOL", airtable_program_key: "BOL|BOL: PP" }]);
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-bol");
  assertEquals(showUpdates.length, 0);
});

Deno.test("airtable-poll grain: a sub-program-only-keyed show is re-keyed to composite + program set", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL: PP" }]);
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 1);
  assertEquals(showUpdates[0], { airtable_program_key: "BOL|BOL: PP", program: "BOL" });
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-bol");
});

Deno.test("airtable-poll grain: composite-keyed show with null program gets program written through", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL|BOL: PP" }]);
  const { showUpdates } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 1);
  assertEquals(showUpdates[0], { program: "BOL" });
});

Deno.test("airtable-poll grain: program unmapped → no shows write, resolves as before", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } }];
  const { deps } = seededDeps(records); // existing helper: FIELD_MAP (no program), show-magic keyed "Magic"
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 0);
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-magic");
});

Deno.test("airtable-poll grain: re-key DB error → record held, no show_dates insert, run does not crash", async () => {
  // Legacy-keyed show (sub-program-only key) so the self-heal branch triggers.
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL: PP" }]);

  const showDateInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "shows") {
      // Force the re-key update to return a DB error.
      chain.update = (_payload: unknown) => {
        const errChain = {
          eq: (_col: string, _val: unknown) => ({
            then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
              resolve({ data: null, error: { message: "db error" } }),
          }),
        };
        return errChain as unknown as FakeChain;
      };
    }
    if (table === "show_dates") {
      const origInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        showDateInserts.push(payload);
        const insertChain = origInsert(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Re-key failed → show not resolved → record held
  assertEquals(body.held, 1);
  // No show_dates row should have been inserted
  assertEquals(showDateInserts.length, 0);
});

Deno.test("airtable-poll grain: program write-through DB error → record still imported, run does not crash", async () => {
  // Composite-keyed show with null program → the write-through path (not re-key) fires.
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL|BOL: PP" }]);

  const showDateInserts: unknown[] = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "shows") {
      // Force the program write-through update to return a DB error.
      chain.update = (_payload: unknown) => ({
        eq: (_col: string, _val: unknown) => ({
          then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
            resolve({ data: null, error: { message: "db error" } }),
        }),
      }) as unknown as FakeChain;
    }
    if (table === "show_dates") {
      const origInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        showDateInserts.push(payload);
        const insertChain = origInsert(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Show resolves via the composite key; the failed write-through must NOT block the import.
  assertEquals(body.held, 0);
  assertEquals(body.new_dates, 1);
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-bol");
});
