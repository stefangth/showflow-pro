/**
 * Regression test for the silent "success / 0 rows" import (spec §11).
 * Feeds the poll a fake Airtable page using the REAL German field names and the Phase-2
 * field map + catalog-link keys. Asserts linked records land, unlinked are held, and both
 * the summary log + per-record logs are written.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";

const FIELD_MAP = {
  date: "Datum",
  program: "Program",
  sub_program: "Sub-Programm",
  city: "City",
  venue: "Venue",
  session_1: "1. Show",
  session_2: "2. Show",
  session_3: "3. Show",
};

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function seededDeps() {
  const showDateInserts: Record<string, unknown>[] = [];
  const recordLogInserts: unknown[] = [];
  const syncLogInserts: Record<string, unknown>[] = [];

  const records = [
    // linked: Sub-Programm "Candlelight Classics" matches a show airtable_program_key
    { id: "recLINKED", fields: { Datum: "2026-07-15", Program: "Candlelight", "Sub-Programm": "Candlelight Classics", City: "BERLIN", Venue: "Tempodrom", "1. Show": "T19:00:00", "2. Show": "T21:30:00", "3. Show": "T23:00:00" } },
    // unlinked: no show has this key → held
    { id: "recHELD", fields: { Datum: "2026-07-16", Program: "Candlelight", "Sub-Programm": "Unmapped Program", City: "Berlin" } },
    // missing date → held
    { id: "recNODATE", fields: { Program: "Candlelight", "Sub-Programm": "Candlelight Classics" } },
  ];

  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Events" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-cc", airtable_program_key: "Candlelight Classics" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      // .insert(...).select('id').single() returns this id; .maybeSingle() (prev-log fetch) also returns it.
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () => Promise.resolve(airtableResponse(records)) as Promise<Response>,
  });

  // Capture inserts for show_dates / record-log / sync-log.
  // deno-lint-ignore no-explicit-any
  const originalFrom = (deps.admin.from as any).bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: Record<string, unknown>) => {
        showDateInserts.push(p);
        const c = orig(p);
        // give the inserted row a stable id for offer opening
        c.single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return c;
      };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return orig(p); };
    }
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: Record<string, unknown>) => { syncLogInserts.push(p); return orig(p); };
    }
    return chain;
  };

  return { deps, invokeCalls, showDateInserts, recordLogInserts, syncLogInserts };
}

Deno.test("airtable-poll regression: German field names import linked rows + hold unlinked + write logs", async () => {
  const { deps, showDateInserts, recordLogInserts, syncLogInserts } = seededDeps();
  const res = await handle(makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } }), deps);
  assertEquals(res.status, 200);

  // 1) the linked record imported into show_dates with the resolved show + city + parsed sessions
  assertEquals(showDateInserts.length, 1);
  const sd = showDateInserts[0];
  assertEquals(sd.show_id, "show-cc");
  assertEquals(sd.date, "2026-07-15");
  assertEquals(sd.airtable_record_id, "recLINKED");
  assertEquals(sd.session_1, "19:00");
  assertEquals(sd.session_2, "21:30");
  assertEquals(sd.session_3, "23:00");
  assertEquals(sd.venue, "Tempodrom");
  assertEquals(sd.city_id, "city-berlin"); // 'BERLIN' resolved to the 'berlin' link key — case-insensitive

  // 2) the summary log was written with correct counts + partial status (held > 0)
  assertEquals(syncLogInserts.length, 1);
  const log = syncLogInserts[0];
  assertEquals(log.org_id, ORG);
  assertEquals(log.status, "partial");
  assertEquals(log.imported_count, 1);
  assertEquals(log.new_count, 1);
  assertEquals(log.updated_count, 0);
  assertEquals(log.held_count, 2);

  // 3) per-record logs written for all three records with the right actions
  const rows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 3);
  const byId = Object.fromEntries(rows.map((r) => [r.airtable_record_id, r]));
  assertEquals(byId["recLINKED"].action, "imported_new");
  assertEquals(byId["recHELD"].action, "held_unresolved");
  assertEquals(byId["recHELD"].reason, "program 'Unmapped Program' not linked");
  assertEquals(byId["recNODATE"].action, "held_unresolved");
  assertEquals(byId["recNODATE"].reason, "missing date");
});
