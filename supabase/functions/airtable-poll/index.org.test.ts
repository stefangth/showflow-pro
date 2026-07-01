// supabase/functions/airtable-poll/index.org.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG_ON = "00000000-0000-0000-0000-0000000000a1";
const ORG_OFF = "00000000-0000-0000-0000-0000000000a2";
const auth = { "X-Cron-Secret": "s" };

Deno.test("airtable-poll: skips orgs with sync disabled or no key; syncs the enabled+keyed org", async () => {
  const { deps } = makeFakeDeps({
    envVars: {},
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG_ON, value: true }, { org_id: ORG_OFF, value: false }, { org_id: null, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG_ON, value: "appABCDEFGHIJKLMNO" }, { org_id: null, value: null }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG_ON, value: "ShowDates" }, { org_id: null, value: null }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG_ON, value: { date: "Date", sub_program: "SubProgram" } }] },
      ],
      organizations: { data: [{ id: ORG_ON }, { id: ORG_OFF }], error: null },
      shows: { data: [{ id: "show-on", airtable_program_key: "P" }], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      get_org_airtable_key: { data: "key_on", error: null },
      get_cron_secret: { data: "s", error: null },
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 })),
  });

  // capture sync_log inserts
  const logs: any[] = [];
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (t: string) => {
    const chain = originalFrom(t);
    if (t === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { logs.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(makeRequest({ headers: auth }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // one org synced
  assertEquals(body.orgs_synced, 1);
  // sync_log carries the org_id of the synced org
  assertEquals(logs.length, 1);
  assertEquals(logs[0].org_id, ORG_ON);
});

Deno.test("airtable-poll: org with sync enabled but no Vault key is skipped (no fetch)", async () => {
  let fetched = 0;
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG_ON, value: true }, { org_id: null, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG_ON, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG_ON, value: "ShowDates" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG_ON, value: { date: "Date", sub_program: "SubProgram" } }] },
      ],
      organizations: { data: [{ id: ORG_ON }], error: null },
      shows: { data: [], error: null }, cities: { data: [], error: null },
      show_dates: { data: [], error: null }, airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null }, notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: null, error: null }, get_cron_secret: { data: "s", error: null } }, // no key
    fetchImpl: () => { fetched++; return Promise.resolve(new Response("{}", { status: 200 })); },
  });
  const res = await handle(makeRequest({ headers: auth }), deps);
  assertEquals(res.status, 200);
  assertEquals(fetched, 0);
});
