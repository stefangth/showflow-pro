/**
 * Deep DI tests for airtable-poll handler (per-org model).
 *
 * The handler loops ACTIVE orgs; for each it resolves airtable_sync_enabled /
 * airtable_base_id / airtable_table_name (org override ?? platform default) and
 * the Vault key via the get_org_airtable_key RPC, then runs syncOrg. These tests
 * exercise syncOrg through handle() with a single enabled+keyed org (ORG).
 *
 * Coverage:
 *  - Auth (cron-secret: missing, wrong, correct)
 *  - Sync disabled / missing base / missing table → org skipped (orgs_synced 0)
 *  - Invalid baseId format → org skipped, sync_log error row carries org_id
 *  - No Vault key → org skipped, no fetch
 *  - Fetch URL and Authorization header shape (key from the Vault RPC)
 *  - Field mapping: Date, Show, Sub Program, City, Session 1 variants
 *  - Show name resolution (program|sub_program key, fallback to program-only)
 *  - Unresolvable show → skipped record, count in totals
 *  - New-date detection: insert + invokeFunction('open-offer-tier')
 *  - Existing-date detection: update only, no invokeFunction call
 *  - Totals shape: { orgs_synced, processed, new_dates, tiers_opened, skipped }
 *  - Batch resilience: one invokeFunction reject → others still run, still 200
 *  - Airtable API error → run still 200 with orgs_synced 0; sync_log error row w/ org_id
 *  - airtable_sync_log written (with org_id) on success and error
 *
 * NOT COVERED (noted):
 *  - Multi-page Airtable pagination (offset handling) — single-page only tested.
 *    See bug-log row: COVERAGE-GAP-01.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG = "00000000-0000-0000-0000-0000000000a1";

/** Per-key app_settings resolver rows that enable sync for ORG. */
const ENABLED_SETTINGS = [
  { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
  { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] }, // 17-char valid format
  { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
];

/** Airtable API response with one record */
function makeAirtableResponse(records: unknown[], offset?: string) {
  return new Response(
    JSON.stringify({ records, ...(offset ? { offset } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A minimal valid Airtable record */
function makeRecord(
  id: string,
  fields: Record<string, unknown>,
): { id: string; fields: Record<string, unknown> } {
  return { id, fields };
}

/**
 * Build deps seeded for a full happy-path run with one new date.
 * Override individual options as needed.
 */
function makeHappyDeps(opts: {
  airtableRecords?: Array<{ id: string; fields: Record<string, unknown> }>;
  existingShowDates?: Array<{ id: string; airtable_record_id: string }>;
  fetchImpl?: typeof fetch;
} = {}) {
  const {
    airtableRecords = [
      makeRecord("recNEW001", {
        Date: "2026-07-15",
        Show: "TestShow",
        City: "Berlin",
        "Session 1": "T20:00:00",
      }),
    ],
    existingShowDates = [],
    fetchImpl,
  } = opts;

  const resolvedFetchImpl: typeof fetch =
    fetchImpl ??
    (() => Promise.resolve(makeAirtableResponse(airtableRecords)) as Promise<Response>);

  const { deps, invokeCalls, calls } = makeFakeDeps({
    tables: {
      // app_settings:
      //   - maybeSingle() on key='cron_secret' (platform row) → value "secret123"
      //   - resolver rows for sync config, scoped to ORG
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      // shows: loaded once per org via .select('id, program, sub_program').eq('org_id', ORG).limit(10000)
      shows: {
        data: [{ id: "show-uuid-1", program: "TestShow", sub_program: null }],
        error: null,
      },
      // cities: loaded once per org
      cities: {
        data: [{ id: "city-uuid-berlin", name: "Berlin" }],
        error: null,
      },
      // show_dates: existing rows keyed by airtable_record_id
      show_dates: {
        data: existingShowDates,
        error: null,
      },
      // airtable_sync_log: just accept insert silently
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: resolvedFetchImpl,
  });

  return { deps, invokeCalls, calls };
}

/** Authenticated request helper */
function authReq(extraHeaders: Record<string, string> = {}) {
  return makeRequest({
    method: "POST",
    headers: { "X-Cron-Secret": "secret123", ...extraHeaders },
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

Deno.test("airtable-poll: missing X-Cron-Secret → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
      ],
    },
  });
  const res = await handle(makeRequest({ method: "POST" }), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("airtable-poll: wrong X-Cron-Secret → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
      ],
    },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { "X-Cron-Secret": "WRONG" } }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("airtable-poll: null stored secret treated as empty string — non-empty header → 401", async () => {
  // storedSecret defaults to '' when no cron_secret row found
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        // maybeSingle() returns null data when no row
        { when: { key: "cron_secret" }, data: null },
      ],
    },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { "X-Cron-Secret": "anysecret" } }),
    deps,
  );
  assertEquals(res.status, 401);
});

// ─── Per-org skip paths (disabled / unconfigured / bad base / no key) ─────────

Deno.test("airtable-poll: org with sync disabled → 200, org skipped", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
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

Deno.test("airtable-poll: org missing base_id → 200, org skipped", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        // no airtable_base_id row for ORG → resolver returns null fallback
        { when: { key: "airtable_base_id" }, data: [{ org_id: null, value: null }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
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

Deno.test("airtable-poll: org missing table_name → 200, org skipped", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        // no airtable_table_name row for ORG → resolver returns null fallback
        { when: { key: "airtable_table_name" }, data: [{ org_id: null, value: null }] },
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

Deno.test("airtable-poll: invalid base_id format → 200, org skipped, sync_log error row with org_id", async () => {
  const syncLogInserts: unknown[] = [];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "NOTVALIDFORMAT" }] }, // doesn't start with 'app'
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.orgs_synced, 0);
  // The bad-base path logs an error row carrying org_id.
  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.status, "error");
  assertExists(logRow.error_details);
});

Deno.test("airtable-poll: org with no Vault key → 200, org skipped, no fetch", async () => {
  let fetched = 0;
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: null, error: null } }, // no key
    fetchImpl: () => { fetched++; return Promise.resolve(makeAirtableResponse([])) as Promise<Response>; },
  });
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.orgs_synced, 0);
  assertEquals(fetched, 0);
});

// ─── Fetch URL and Authorization header ──────────────────────────────────────

Deno.test("airtable-poll: fetch called with correct Airtable URL and Bearer token (key from Vault)", async () => {
  const capturedRequests: Array<{ url: string; init: RequestInit }> = [];

  const fetchImpl: typeof fetch = (url, init) => {
    capturedRequests.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(makeAirtableResponse([])) as Promise<Response>;
  };

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "My Table" }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "my-api-key-xyz", error: null } },
    fetchImpl,
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  // Exactly one fetch call (zero records = no pagination)
  assertEquals(capturedRequests.length, 1);

  const { url, init } = capturedRequests[0];

  // URL: base/table/encoded-table-name?view=Grid%20view
  assertEquals(
    url.includes("https://api.airtable.com/v0/appABCDEFGHIJKLMNO/"),
    true,
    `URL should include airtable base: ${url}`,
  );
  // Table name is URL-encoded
  assertEquals(
    url.includes("My%20Table"),
    true,
    `URL should URL-encode table name: ${url}`,
  );
  assertEquals(
    url.includes("view=Grid%20view"),
    true,
    `URL should include view param: ${url}`,
  );

  // Authorization header: Bearer <key from Vault RPC>
  const headers = init.headers as Record<string, string>;
  assertExists(headers, "fetch headers should be set");
  assertEquals(
    headers["Authorization"],
    "Bearer my-api-key-xyz",
    `Authorization header should be Bearer token`,
  );
});

// ─── Field mapping ────────────────────────────────────────────────────────────

Deno.test("airtable-poll: maps Date/Show/City/Session fields and inserts show_date", async () => {
  const insertedPayloads: unknown[] = [];

  // We intercept the insert by wrapping the fake client's from() method
  const records = [
    makeRecord("recABC123", {
      Date: "2026-08-20",
      Show: "TestShow",
      City: "Berlin",
      "Session 1": "T19:30:00",
    }),
  ];

  const { deps } = makeHappyDeps({
    airtableRecords: records,
  });

  // Wrap the admin client's from() to capture insert args
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = (chain as any).insert.bind(chain);
      (chain as any).insert = (payload: unknown) => {
        insertedPayloads.push(payload);
        return originalInsert(payload as any);
      };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  // At least one insert payload captured
  assertEquals(insertedPayloads.length >= 1, true, "Expected at least one insert call");

  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.show_id, "show-uuid-1");
  assertEquals(payload.date, "2026-08-20");
  assertEquals(payload.airtable_record_id, "recABC123");
  assertEquals(payload.city_id, "city-uuid-berlin");
  assertEquals(payload.session_1, "19:30"); // extracted HH:MM from T19:30:00
  // org_id is NOT set on the insert payload — the derive trigger stamps it.
  assertEquals("org_id" in payload, false);
});

Deno.test("airtable-poll: accepts alternate field name variants (date/show/city/session_1)", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recVAR001", {
      date: "2026-09-01", // lowercase 'date'
      show: "TestShow", // lowercase 'show'
      city: "berlin", // lowercase city name
      session_1: "14:00", // lowercase session_1 (no T prefix)
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        insertedPayloads.push(payload);
        return (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
      };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(insertedPayloads.length >= 1, true, "Expected insert with lowercase field names");
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.date, "2026-09-01");
  assertEquals(payload.session_1, "14:00");
});

Deno.test("airtable-poll: session_1 defaults to 00:00 when field missing", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNOSESSION", {
      Date: "2026-10-10",
      Show: "TestShow",
      // No Session 1 / session_1 / Start Time field
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.session_1, "00:00");
});

Deno.test("airtable-poll: city_id is null when city not in DB", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNOCITY001", {
      Date: "2026-11-01",
      Show: "TestShow",
      City: "Atlantis", // not in cities table
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.city_id, null);
});

Deno.test("airtable-poll: record without Date field is skipped entirely", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNODATE001", {
      Show: "TestShow",
      // No Date field
    }),
    makeRecord("recWITHDATE", {
      Date: "2026-12-01",
      Show: "TestShow",
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  // Only the record WITH a Date should be inserted
  assertEquals(insertedPayloads.length, 1);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.airtable_record_id, "recWITHDATE");
});

// ─── Show name resolution ─────────────────────────────────────────────────────

Deno.test("airtable-poll: resolves show by (program, sub_program) key — exact match wins", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recSUBPROG001", {
      Date: "2026-07-01",
      Show: "TestShow",
      "Sub Program": "Alpha",
    }),
  ];

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: {
        data: [
          { id: "show-generic", program: "TestShow", sub_program: null },
          { id: "show-alpha", program: "TestShow", sub_program: "Alpha" },
        ],
        error: null,
      },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse(records)) as Promise<Response>,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  // Exact (program, sub_program) match should win
  assertEquals(payload.show_id, "show-alpha");
});

Deno.test("airtable-poll: falls back to program-only match when sub_program absent in DB", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recFALLBACK", {
      Date: "2026-07-02",
      Show: "TestShow",
      "Sub Program": "Beta", // DB has no Beta sub_program row
    }),
  ];

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: {
        data: [
          { id: "show-generic", program: "TestShow", sub_program: null }, // only program-only row
        ],
        error: null,
      },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse(records)) as Promise<Response>,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.show_id, "show-generic");
});

Deno.test("airtable-poll: unresolvable show → record skipped, skipped count in totals", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recUNKNOWN", {
      Date: "2026-07-03",
      Show: "UnknownShow",
    }),
    makeRecord("recKNOWN", {
      Date: "2026-07-04",
      Show: "TestShow",
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Only 1 of 2 records should result in an insert (the known show)
  assertEquals(insertedPayloads.length, 1);
  // The skipped count should be 1 (unresolved show)
  assertEquals(body.skipped, 1);
});

// ─── New-date detection: invokeFunction ──────────────────────────────────────

Deno.test("airtable-poll: new date → invokeFunction('open-offer-tier', { show_date_id, tier: 1 })", async () => {
  const { deps, invokeCalls } = makeHappyDeps({
    airtableRecords: [
      makeRecord("recNEW001", { Date: "2026-07-15", Show: "TestShow" }),
    ],
  });

  // Override show_dates to make insert().select().single() return a new id.
  let insertCalled = false;
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        insertCalled = true;
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // Override single() to return our fake inserted id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (insertChain as any).single = () =>
          Promise.resolve({ data: { id: "new-date-uuid-001" }, error: null });
        return insertChain;
      };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  // Verify totals shape
  assertEquals(typeof body.orgs_synced, "number");
  assertEquals(typeof body.processed, "number");
  assertEquals(typeof body.new_dates, "number");
  assertEquals(typeof body.tiers_opened, "number");
  assertEquals(typeof body.skipped, "number");

  assertEquals(insertCalled, true, "insert should have been called");
  assertEquals(body.orgs_synced, 1);
  assertEquals(body.new_dates, 1);

  // invokeFunction should have been called with open-offer-tier
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 1);
  assertEquals((offerCalls[0].body as any).show_date_id, "new-date-uuid-001");
  assertEquals((offerCalls[0].body as any).tier, 1);
  assertEquals(body.tiers_opened, 1);
});

Deno.test("airtable-poll: existing date → update only, NO invokeFunction call", async () => {
  const updateArgs: unknown[] = [];

  const records = [
    makeRecord("recEXISTING", { Date: "2026-07-20", Show: "TestShow" }),
  ];

  const { deps, invokeCalls } = makeHappyDeps({
    airtableRecords: records,
    existingShowDates: [{ id: "existing-uuid-001", airtable_record_id: "recEXISTING" }],
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => {
        updateArgs.push(payload);
        return (originalUpdate as (x: unknown) => ReturnType<typeof originalUpdate>)(payload);
      };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.new_dates, 0);

  // No offer-tier invocations for existing dates
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);

  // Update should have been called with date and session_1
  assertEquals(updateArgs.length >= 1, true, "update should have been called");
  const updatePayload = updateArgs[0] as Record<string, unknown>;
  assertEquals(updatePayload.date, "2026-07-20");
  assertExists(updatePayload.session_1 !== undefined, "update payload should have session_1");
});

// ─── Totals shape ─────────────────────────────────────────────────────────────

Deno.test("airtable-poll: totals contain all required fields on success (0 records)", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // All required fields
  assertEquals(typeof body.orgs_synced, "number");
  assertEquals(typeof body.processed, "number");
  assertEquals(typeof body.new_dates, "number");
  assertEquals(typeof body.tiers_opened, "number");
  assertEquals(typeof body.skipped, "number");

  // One org ran but produced no records
  assertEquals(body.orgs_synced, 1);
  assertEquals(body.processed, 0);
  assertEquals(body.new_dates, 0);
  assertEquals(body.tiers_opened, 0);
  assertEquals(body.skipped, 0);
});

// ─── Batch resilience ─────────────────────────────────────────────────────────

Deno.test("airtable-poll: one invokeFunction rejection → others still run, still 200, partial tiers_opened", async () => {
  /**
   * Seed 3 new records. Override invokeFunction so the second one rejects.
   * Assert: response is 200, tiers_opened = 2 (not 3), processed = 3.
   */
  const newRecords = [
    makeRecord("recBATCH001", { Date: "2026-08-01", Show: "TestShow" }),
    makeRecord("recBATCH002", { Date: "2026-08-02", Show: "TestShow" }),
    makeRecord("recBATCH003", { Date: "2026-08-03", Show: "TestShow" }),
  ];

  // Map from record id -> generated show_date uuid
  const recordToUuid: Record<string, string> = {
    recBATCH001: "uuid-batch-001",
    recBATCH002: "uuid-batch-002",
    recBATCH003: "uuid-batch-003",
  };
  const insertOrder: string[] = [];

  const { deps, invokeCalls } = makeHappyDeps({ airtableRecords: newRecords });

  // Patch insert to return distinct UUIDs per airtable_record_id
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        const airtableId = p.airtable_record_id as string;
        insertOrder.push(airtableId);
        const uuid = recordToUuid[airtableId] ?? "uuid-unknown";
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (insertChain as any).single = () =>
          Promise.resolve({ data: { id: uuid }, error: null });
        return insertChain;
      };
    }
    return chain;
  };

  // Override invokeFunction: reject for uuid-batch-002, succeed for others
  let invokeCallCount = 0;
  const invokedIds: string[] = [];
  deps.invokeFunction = (name: string, body: unknown) => {
    const b = body as Record<string, unknown>;
    const id = b.show_date_id as string;
    invokedIds.push(id);
    invokeCallCount += 1;
    if (id === "uuid-batch-002") {
      return Promise.reject(new Error("simulated invokeFunction failure"));
    }
    invokeCalls.push({ name, body });
    return Promise.resolve({ data: null, error: null });
  };

  const res = await handle(authReq(), deps);

  // Handler must NOT propagate the rejection — still 200
  assertEquals(res.status, 200, "batch resilience: handler should return 200 even when one invoke rejects");

  const body = await res.json();

  // All 3 inserts processed
  assertEquals(body.processed, 3, "all 3 records should be processed");
  assertEquals(body.new_dates, 3, "all 3 should be counted as new dates");

  // invokeFunction was called for all 3 ids
  assertEquals(invokeCallCount, 3, "invokeFunction should be called for all 3 new dates");
  assertEquals(invokedIds.includes("uuid-batch-001"), true);
  assertEquals(invokedIds.includes("uuid-batch-002"), true);
  assertEquals(invokedIds.includes("uuid-batch-003"), true);

  // Only 2 of 3 succeeded (the one rejecting is not counted)
  assertEquals(body.tiers_opened, 2, "tiers_opened should be 2 (one rejected)");
});

// ─── Airtable API error ───────────────────────────────────────────────────────

Deno.test("airtable-poll: Airtable API error → run still 200, org skipped (orgs_synced 0)", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    // Return a non-ok response from Airtable
    fetchImpl: () =>
      Promise.resolve(
        new Response("Unauthorized", { status: 401 }),
      ) as Promise<Response>,
  });

  const res = await handle(authReq(), deps);
  // syncOrg throws on the Airtable error; handle() logs + continues → still 200.
  assertEquals(res.status, 200);
  const body = await res.json();
  // The one org failed before completing, so it's not counted as synced.
  assertEquals(body.orgs_synced, 0);
});

// ─── airtable_sync_log written ────────────────────────────────────────────────

Deno.test("airtable-poll: inserts a success row (with org_id) into airtable_sync_log on clean run", async () => {
  const syncLogInserts: unknown[] = [];

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  assertEquals(syncLogInserts.length, 1, "airtable_sync_log should be written exactly once");
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.sync_type, "airtable_poll");
  assertEquals(logRow.status, "success");
  assertEquals(logRow.records_processed, 0);
  // synced_at should be a valid ISO string
  assertExists(logRow.synced_at);
  assertEquals(typeof logRow.synced_at, "string");
});

Deno.test("airtable-poll: inserts an error row (with org_id) into airtable_sync_log on Airtable API error", async () => {
  const syncLogInserts: unknown[] = [];

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () =>
      Promise.resolve(new Response("Forbidden", { status: 403 })) as Promise<Response>,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  // run continues past the failed org
  assertEquals(res.status, 200);

  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.sync_type, "airtable_poll");
  assertEquals(logRow.status, "error");
  assertExists(logRow.error_details);
});

Deno.test("airtable-poll: synced_at uses deps.now() (fixed to 2026-06-01T12:00:00.000Z)", async () => {
  const syncLogInserts: unknown[] = [];
  const fixedNow = new Date("2026-06-01T12:00:00.000Z");

  const { deps } = makeFakeDeps({
    now: fixedNow,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  await handle(authReq(), deps);
  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.synced_at, fixedNow.toISOString());
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

Deno.test("airtable-poll: OPTIONS returns preflight (204)", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});
