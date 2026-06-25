/**
 * Linked-record resolution: City/Venue mapped to Airtable multipleRecordLinks fields.
 * The poll fetches the base schema + each linked table, resolving record IDs → names.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const BASE = "appABCDEFGHIJKLMNO";

function authReq() {
  return makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });
}

Deno.test("airtable-poll: resolves linked-record venue & city to display names", async () => {
  const insertedPayloads: Record<string, unknown>[] = [];

  const fetchImpl: typeof fetch = (url) => {
    const u = String(url);
    if (u.includes("/meta/bases/")) {
      return Promise.resolve(new Response(JSON.stringify({
        tables: [
          { id: "tblEvents", name: "Events", primaryFieldId: "fldDate", fields: [
            { id: "fldDate", name: "Datum", type: "date" },
            { id: "fldSub", name: "Sub", type: "singleSelect" },
            { id: "fldCity", name: "City", type: "multipleRecordLinks", options: { linkedTableId: "tblCities" } },
            { id: "fldVenue", name: "Venue", type: "multipleRecordLinks", options: { linkedTableId: "tblVenues" } },
          ] },
          { id: "tblCities", name: "Cities", primaryFieldId: "fldCityName", fields: [{ id: "fldCityName", name: "City", type: "singleLineText" }] },
          { id: "tblVenues", name: "Venues", primaryFieldId: "fldVenName", fields: [{ id: "fldVenName", name: "Venues", type: "singleLineText" }] },
        ],
      }), { status: 200 })) as Promise<Response>;
    }
    if (u.includes(`/v0/${BASE}/tblCities`)) {
      return Promise.resolve(new Response(JSON.stringify({ records: [{ id: "recCity1", fields: { fldCityName: "Berlin" } }] }), { status: 200 })) as Promise<Response>;
    }
    if (u.includes(`/v0/${BASE}/tblVenues`)) {
      return Promise.resolve(new Response(JSON.stringify({ records: [{ id: "recVen1", fields: { fldVenName: "Hall A" } }] }), { status: 200 })) as Promise<Response>;
    }
    return Promise.resolve(new Response(JSON.stringify({ records: [
      { id: "recEvt1", fields: { Datum: "2026-07-15", Sub: "TestShow", City: ["recCity1"], Venue: ["recVen1"] } },
    ] }), { status: 200 })) as Promise<Response>;
  };

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: BASE }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Events" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Datum", sub_program: "Sub", city: "City", venue: "Venue" } }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p as Record<string, unknown>); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(insertedPayloads.length, 1);
  assertEquals(insertedPayloads[0].venue, "Hall A");
  assertEquals(insertedPayloads[0].city_id, "city-berlin");
});
