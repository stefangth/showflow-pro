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

function seededDeps(records: unknown[], existingShowDates: Record<string, unknown>[] = []) {
  const showDateInserts: Record<string, unknown>[] = [];
  const showDateUpdates: Record<string, unknown>[] = [];
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
      show_dates: { data: existingShowDates, error: null },
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
    if (table === "show_dates") {
      const origUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => { showDateUpdates.push(payload as Record<string, unknown>); return origUpdate(payload); };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return orig(p); };
    }
    return chain;
  });

  return { deps, showDateInserts, showDateUpdates, recordLogInserts };
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

// The city hold is for NEW records only: an already-imported date whose city becomes unlinked
// must still UPDATE (so Airtable cancellations/revivals keep propagating), keeping its prior
// city_id. It must not be held, which would freeze it (a cancelled show could stay bookable).
Deno.test("airtable-poll: an existing record with a now-unlinked city still updates (not held)", async () => {
  const records = [
    // program linked, city "Paris" unlinked, but this record already exists -> UPDATE, not held
    { id: "rec-exist", fields: { Date: "2026-06-09", SubProgram: "Magic", City: "Paris" } },
  ];
  const existing = [{ id: "sd-existing", airtable_record_id: "rec-exist", status: "open" }];

  const { deps, showDateInserts, showDateUpdates, recordLogInserts } = seededDeps(records, existing);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(showDateInserts.length, 0);
  assertEquals(showDateUpdates.length, 1);
  // The update does NOT overwrite city_id when the city is unlinked (keeps the prior value).
  assertEquals(Object.prototype.hasOwnProperty.call(showDateUpdates[0], "city_id"), false);
  assertEquals(body.held, 0);

  const rows = (recordLogInserts[0] ?? []) as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.airtable_record_id === "rec-exist");
  assertEquals(row?.action, "updated");
});
