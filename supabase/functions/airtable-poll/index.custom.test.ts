import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000c1";
const FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City" };

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Seed an enabled+keyed ORG with one linked show + city AND two custom field defs. */
function seededDeps(records: unknown[], showDatesData: unknown[] = []) {
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
      show_dates: { data: showDatesData, error: null },
      custom_field_definitions: { data: [
        { key: "capacity", source_field: "Capacity", type: "number" },
        { key: "headliner", source_field: "Headliner", type: "text" },
      ], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: (() => Promise.resolve(airtableResponse(records))) as typeof fetch,
  });
}

const authReq = () => makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });

/** Capture show_dates insert payloads via the documented from() override trick. */
function captureInserts(deps: ReturnType<typeof seededDeps>["deps"], captured: unknown[]) {
  const originalFrom = deps.admin.from.bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      // deno-lint-ignore no-explicit-any
      (chain as any).insert = (payload: unknown) => {
        captured.push(payload);
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // deno-lint-ignore no-explicit-any
        (insertChain as any).single = () =>
          Promise.resolve({ data: { id: `sd-${(payload as Record<string, unknown>).airtable_record_id}` }, error: null });
        return insertChain;
      };
    }
    return chain;
  };
}

/** Capture show_dates update payloads via the same from() override trick. */
function captureUpdates(deps: ReturnType<typeof seededDeps>["deps"], captured: unknown[]) {
  const originalFrom = deps.admin.from.bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalUpdate = chain.update.bind(chain);
      // deno-lint-ignore no-explicit-any
      (chain as any).update = (payload: unknown) => { captured.push(payload); return originalUpdate(payload as Record<string, unknown>); };
    }
    return chain;
  };
}

Deno.test("airtable-poll custom: writes coerced custom bag on insert, omits missing/bad keys", async () => {
  const records = [
    { id: "rec-1", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", Capacity: "250", Headliner: "Houdini" } },
    { id: "rec-2", fields: { Date: "2026-06-02", SubProgram: "Magic", City: "Berlin", Capacity: "n/a" } },
  ];
  const { deps } = seededDeps(records);
  const inserts: unknown[] = [];
  captureInserts(deps, inserts);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const p1 = inserts[0] as Record<string, unknown>;
  assertEquals(p1.custom, { capacity: 250, headliner: "Houdini" });

  const p2 = inserts[1] as Record<string, unknown>;
  assertEquals(p2.custom, {});
});

Deno.test("airtable-poll custom: a malformed custom value never holds/drops the date", async () => {
  const records = [
    { id: "rec-3", fields: { Date: "2026-06-03", SubProgram: "Magic", Capacity: { bad: true } } },
  ];
  const { deps } = seededDeps(records);
  const inserts: unknown[] = [];
  captureInserts(deps, inserts);

  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(body.new_dates, 1);
  assertEquals((inserts[0] as Record<string, unknown>).custom, {});
});

Deno.test("airtable-poll custom: writes the coerced bag on update (replace semantics)", async () => {
  const records = [
    { id: "rec-up", fields: { Date: "2026-07-01", SubProgram: "Magic", City: "Berlin", Capacity: "300" } },
  ];
  // Seed an existing show_dates row so the record takes the UPDATE branch.
  const { deps } = seededDeps(records, [{ id: "sd-existing", airtable_record_id: "rec-up" }]);
  const updates: unknown[] = [];
  captureUpdates(deps, updates);

  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(body.updated, 1);
  // Headliner is absent from the record → omitted; only capacity is written.
  assertEquals((updates[0] as Record<string, unknown>).custom, { capacity: 300 });
});
