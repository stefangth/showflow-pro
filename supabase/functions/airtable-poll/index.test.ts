/**
 * Contract tests for the airtable-poll edge function.
 *
 * These exercise the REAL `handle` (no re-implemented model) against the
 * field-map/key contract: resolution is driven by app_settings.airtable_field_map +
 * the catalog-link keys (shows.airtable_program_key, cities.airtable_city_key), and the
 * outcome vocabulary is imported_new / updated / held_unresolved (no "skipped").
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
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
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
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
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
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
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        insertedPayloads.push(p);
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        (insertChain as any).single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return insertChain;
      };
    }
    return chain;
  };

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

Deno.test("airtable-poll contract: missing cron secret is unauthorized", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }] },
  });
  const res = await handle(makeRequest({ method: "POST" }), deps);
  assertEquals(res.status, 401);
});
