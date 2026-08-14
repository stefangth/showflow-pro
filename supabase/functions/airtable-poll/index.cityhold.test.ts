/**
 * A mapped, non-empty city that doesn't resolve to a linked catalog city HOLDS the record
 * (like an unlinked program), instead of importing it city-less. A blank/absent city, or an
 * unmapped city field, still imports with city_id null.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000c2";
const FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City" };

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function seededDeps(records: unknown[]) {
  const showDateInserts: Record<string, unknown>[] = [];
  const recordLogInserts: unknown[] = [];

  const { deps } = makeFakeDeps({
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
    fetchImpl: () => Promise.resolve(airtableResponse(records)) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        showDateInserts.push(p);
        const c = orig(p);
        c.single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return c;
      };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return orig(p); };
    }
    return chain;
  });

  return { deps, showDateInserts, recordLogInserts };
}

const authReq = () => makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });

Deno.test("airtable-poll: a mapped non-empty unlinked city holds the record; blank/absent city still imports", async () => {
  const records = [
    // program linked, city "Berlin" resolves -> imported_new
    { id: "rec-ok", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } },
    // program linked, city "Paris" present but NOT in the link map -> HELD
    { id: "rec-city", fields: { Date: "2026-06-02", SubProgram: "Magic", City: "Paris" } },
    // program linked, no city value -> still imports (city optional when blank/absent)
    { id: "rec-nocity", fields: { Date: "2026-06-03", SubProgram: "Magic" } },
  ];

  const { deps, showDateInserts, recordLogInserts } = seededDeps(records);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // rec-ok and rec-nocity import; rec-city is held.
  assertEquals(showDateInserts.length, 2);
  const insertedIds = showDateInserts.map((p) => p.airtable_record_id).sort();
  assertEquals(insertedIds, ["rec-nocity", "rec-ok"]);
  assertEquals(body.held, 1);

  const rows = recordLogInserts[0] as Array<Record<string, unknown>>;
  const byId = Object.fromEntries(rows.map((r) => [r.airtable_record_id, r]));
  assertEquals(byId["rec-city"].action, "held_unresolved");
  assertEquals(byId["rec-city"].reason, "city 'Paris' not linked");
});
