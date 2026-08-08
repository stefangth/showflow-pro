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
 *  - Field mapping driven by app_settings.airtable_field_map (Date/SubProgram/City/Session)
 *  - Show resolution by airtable_program_key; city by airtable_city_key (strict, no name match)
 *  - Unresolvable show → record held, held count in totals
 *  - Unlinked city → city_id null + non-fatal note in the per-record log
 *  - New-date detection: insert + invokeFunction('open-offer-tier')
 *  - Existing-date detection: update only, no invokeFunction call
 *  - Totals shape: { orgs_synced, processed, new_dates, updated, held, tiers_opened }
 *  - Batch resilience: one invokeFunction reject → others still run, still 200
 *  - Airtable API error → run still 200 with orgs_synced 0; sync_log error row w/ org_id
 *  - airtable_sync_log written (with org_id) on success and error
 *  - Per-record airtable_sync_record_log written; admin notification when held set changes
 *
 * NOT COVERED (noted):
 *  - Multi-page Airtable pagination (offset handling) — single-page only tested.
 *    See bug-log row: COVERAGE-GAP-01.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG = "00000000-0000-0000-0000-0000000000a1";

/** Per-key app_settings resolver rows that enable sync for ORG. */
const ENABLED_SETTINGS = [
  { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
  { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] }, // 17-char valid format
  { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
  { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Date", sub_program: "SubProgram", city: "City", session_1: "Session 1", session_2: "Session 2" } }] },
  { when: { key: "airtable_view" }, data: [{ org_id: ORG, value: "Grid view" }] },
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
        SubProgram: "TestShow",
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
      // shows: loaded once per org via .select('id, airtable_program_key').eq('org_id', ORG).limit(10000)
      shows: {
        data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }],
        error: null,
      },
      // cities: loaded once per org, keyed by airtable_city_key
      cities: {
        data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }],
        error: null,
      },
      // show_dates: existing rows keyed by airtable_record_id
      show_dates: {
        data: existingShowDates,
        error: null,
      },
      // airtable_sync_log: insert now does .select('id').single(); also serves the prev-log maybeSingle()
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
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

/**
 * Deps for interval-gate and manual-sync tests: one enabled+keyed org, empty catalog,
 * an Airtable-page fetch spy, and a seedable last-poll timestamp. `memberRole`/`authUser`
 * feed requireOrgRole for the manual-sync path. `capabilityEnabled` (when set) seeds the
 * is_capability_enabled RPC for the producer_can_trigger_sync gate.
 */
function makeGateDeps(opts: {
  lastSyncedAt?: string | null;
  intervalMinutes?: number;
  now?: Date;
  authUser?: { id: string };
  memberRole?: string | null;
  capabilityEnabled?: boolean;
} = {}) {
  const fetchSpy = { count: 0 };
  const fetchImpl = ((url: string) => {
    if (String(url).includes("api.airtable.com")) fetchSpy.count += 1;
    return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof fetch;

  const intervalRows = opts.intervalMinutes != null
    ? [{ when: { key: "airtable_poll_interval_minutes" }, data: [{ org_id: ORG, value: opts.intervalMinutes }] }]
    : [];

  const { deps, invokeCalls, calls } = makeFakeDeps({
    now: opts.now ?? new Date("2026-06-01T12:00:00.000Z"),
    authUser: opts.authUser,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // Field map WITHOUT city/venue: those trigger an extra meta-API fetch
        // (fetchBaseTables) that would double-count fetchSpy per poll below.
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Date", sub_program: "SubProgram" } }] },
        ...ENABLED_SETTINGS,
        ...intervalRows,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      custom_field_definitions: { data: [], error: null },
      airtable_sync_log: opts.lastSyncedAt !== undefined
        ? { data: opts.lastSyncedAt === null ? null : { synced_at: opts.lastSyncedAt }, error: null }
        : { data: null, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: opts.memberRole ? { role: opts.memberRole } : null, error: null },
      platform_admins: { data: null, error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      get_org_airtable_key: { data: "key", error: null },
      get_cron_secret: { data: "secret123", error: null },
      ...(opts.capabilityEnabled !== undefined
        ? { is_capability_enabled: { data: opts.capabilityEnabled, error: null } }
        : {}),
    },
    fetchImpl,
  });
  return { deps, invokeCalls, calls, fetchSpy };
}

// ─── Auth ────────────────────────────────────────────────────────────────────
// Post-C1 the cron secret comes from the Vault-backed get_cron_secret RPC, not
// member-readable app_settings. This endpoint is CRON-SECRET-ONLY (requireCronSecret):
// it fans out over every active org and writes each org's data, so an org-admin JWT
// must NOT be able to drive it (the old requireCronOrRole role fallback was a cross-org hole).

Deno.test("airtable-poll: missing X-Cron-Secret → 401 (no user JWT either)", async () => {
  const { deps } = makeFakeDeps({
    rpcs: { get_cron_secret: { data: "secret123", error: null } },
  });
  const res = await handle(makeRequest({ method: "POST" }), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("airtable-poll: wrong X-Cron-Secret → 401", async () => {
  const { deps } = makeFakeDeps({
    rpcs: { get_cron_secret: { data: "secret123", error: null } },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { "X-Cron-Secret": "WRONG" } }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("airtable-poll: null Vault secret treated as empty string — non-empty header → 401", async () => {
  // storedSecret defaults to '' when the RPC returns null (secret not provisioned).
  const { deps } = makeFakeDeps({
    rpcs: { get_cron_secret: { data: null, error: null } },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { "X-Cron-Secret": "anysecret" } }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("airtable-poll: admin JWT without org_id → 400 (JWT path is single-org; never the cron fan-out)", async () => {
  // The cross-org fan-out stays cron-secret-only. A JWT request is the "Sync now" path,
  // which REQUIRES an explicit org_id and can only ever sync that one org — so a JWT can
  // never trigger the fan-out. Without org_id it's a 400, not a fan-out.
  const { deps } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null } },
    rpcs: { get_cron_secret: { data: "secret123", error: null } },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" } }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "org_id required");
});

// ─── Manual "Sync now" (org-admin JWT, single org, gate bypassed) ─────────────

Deno.test("sync-now: org admin + org_id → 200, syncs only that org (bypasses gate)", async () => {
  // last poll 30s ago would be gated on the cron path; the manual path must still run.
  const { deps, fetchSpy } = makeGateDeps({
    lastSyncedAt: "2026-06-01T11:59:30.000Z", authUser: { id: "admin-1" }, memberRole: "admin",
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.orgs_synced, 1);
  assertEquals(fetchSpy.count, 1);
});

Deno.test("sync-now: caller not an admin of the org → 403", async () => {
  const { deps, fetchSpy } = makeGateDeps({ authUser: { id: "user-1" }, memberRole: null });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer user-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals(fetchSpy.count, 0);
});

Deno.test("sync-now: missing org_id → 400", async () => {
  const { deps } = makeGateDeps({ authUser: { id: "admin-1" }, memberRole: "admin" });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: {} }),
    deps,
  );
  assertEquals(res.status, 400);
});

// ─── Manual "Sync now": producer_can_trigger_sync capability gate ────────────
//
// Admins bypass the capability gate outright (proven above: the admin sync-now test
// succeeds although makeGateDeps never seeds is_capability_enabled, which defaults to
// OFF). A caller who is only a producer of the org must additionally hold
// producer_can_trigger_sync.

Deno.test("sync-now: producer with producer_can_trigger_sync ON → 200, syncs the org", async () => {
  const { deps, fetchSpy } = makeGateDeps({
    authUser: { id: "producer-1" }, memberRole: "producer", capabilityEnabled: true,
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer producer-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(fetchSpy.count, 1);
});

Deno.test("sync-now: producer with producer_can_trigger_sync OFF → 403 capability_disabled, no sync", async () => {
  const { deps, fetchSpy } = makeGateDeps({
    authUser: { id: "producer-1" }, memberRole: "producer", capabilityEnabled: false,
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer producer-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "capability_disabled");
  assertEquals(fetchSpy.count, 0);
});

Deno.test("sync-now: admin bypasses the capability gate entirely (never calls is_capability_enabled)", async () => {
  const { deps, calls } = makeGateDeps({ authUser: { id: "admin-1" }, memberRole: "admin" });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "rpc:is_capability_enabled"), false);
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
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
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
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
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
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
    },
    rpcs: { get_org_airtable_key: { data: null, error: null }, get_cron_secret: { data: "secret123", error: null } }, // no key
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
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Date", sub_program: "SubProgram" } }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "my-api-key-xyz", error: null }, get_cron_secret: { data: "secret123", error: null } },
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

/** Capture the Airtable data-fetch URL for one run with the given app_settings rows. */
async function captureAirtableUrl(
  settings: Array<{ when: { key: string }; data: unknown }>,
): Promise<string> {
  const captured: string[] = [];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "My Table" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Date", sub_program: "SubProgram" } }] },
        ...settings,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "my-api-key-xyz", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: (url) => { captured.push(String(url)); return Promise.resolve(makeAirtableResponse([])) as Promise<Response>; },
  });
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  // The helper's Airtable response carries no `offset`, so the poll makes exactly one page
  // fetch. If a caller ever seeds a paginated response, relax this to >= 1 and read captured[0].
  assertEquals(captured.length, 1);
  return captured[0];
}

Deno.test("airtable-poll: airtable_view setting overrides the default view in the fetch URL", async () => {
  const url = await captureAirtableUrl([{ when: { key: "airtable_view" }, data: [{ org_id: ORG, value: "Published" }] }]);
  assertEquals(url.includes("view=Published"), true, `URL should use the configured view: ${url}`);
  assertEquals(url.includes("Grid%20view"), false, `URL should not fall back to the default view: ${url}`);
});

Deno.test("airtable-poll: a blank airtable_view reads the whole table (no view param)", async () => {
  const url = await captureAirtableUrl([{ when: { key: "airtable_view" }, data: [{ org_id: ORG, value: "" }] }]);
  assertEquals(url.includes("view="), false, `Blank view should omit the view param entirely: ${url}`);
});

Deno.test("airtable-poll: trims surrounding whitespace from the configured view", async () => {
  const url = await captureAirtableUrl([{ when: { key: "airtable_view" }, data: [{ org_id: ORG, value: "  Published  " }] }]);
  assertEquals(url.includes("view=Published"), true, `View should be trimmed before encoding: ${url}`);
  assertEquals(url.includes("%20Published"), false, `Leading whitespace must not survive into the view param: ${url}`);
});

Deno.test("airtable-poll: a null-valued airtable_view row falls back to the default view", async () => {
  // resolveOrgSetting itself now falls a null-valued row through to the "Grid view" default;
  // this also pins the handler's belt-and-suspenders `??` so a null row never silently turns
  // into a whole-table read.
  const url = await captureAirtableUrl([{ when: { key: "airtable_view" }, data: [{ org_id: ORG, value: null }] }]);
  assertEquals(url.includes("view=Grid%20view"), true, `Null view row should fall back to the default: ${url}`);
});

// ─── Field mapping ────────────────────────────────────────────────────────────

Deno.test("airtable-poll: maps Date/SubProgram/City/Session fields and inserts show_date", async () => {
  const insertedPayloads: unknown[] = [];

  // We intercept the insert by wrapping the fake client's from() method
  const records = [
    makeRecord("recABC123", {
      Date: "2026-08-20",
      SubProgram: "TestShow",
      City: "Berlin",
      "Session 1": "T19:30:00",
    }),
  ];

  const { deps } = makeHappyDeps({
    airtableRecords: records,
  });

  // Wrap the admin client's from() to capture insert args
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        insertedPayloads.push(payload);
        return originalInsert(payload);
      };
    }
    return chain;
  });

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

Deno.test("airtable-poll: session_1 is null when field missing (no 00:00 fabrication)", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNOSESSION", {
      Date: "2026-10-10",
      SubProgram: "TestShow",
      // No Session 1 field → session_1 is null (mapped, but the Airtable cell is empty)
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.session_1, null);
});

Deno.test("airtable-poll: city_id is null when city not in DB", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNOCITY001", {
      Date: "2026-11-01",
      SubProgram: "TestShow",
      City: "Atlantis", // not in cities table
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  await handle(authReq(), deps);
  assertEquals(insertedPayloads.length >= 1, true);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.city_id, null);
});

Deno.test("airtable-poll: record without Date field is held, not inserted", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recNODATE001", {
      SubProgram: "TestShow",
      // No Date field → held_unresolved
    }),
    makeRecord("recWITHDATE", {
      Date: "2026-12-01",
      SubProgram: "TestShow",
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  // Only the record WITH a Date should be inserted
  assertEquals(insertedPayloads.length, 1);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.airtable_record_id, "recWITHDATE");
});

// ─── Show resolution by airtable_program_key (held when unlinked) ─────────────

Deno.test("airtable-poll: unresolvable show → record held, held count in totals", async () => {
  const insertedPayloads: unknown[] = [];

  const records = [
    makeRecord("recUNKNOWN", {
      Date: "2026-07-03",
      SubProgram: "UnknownShow", // no show has this airtable_program_key → held
    }),
    makeRecord("recKNOWN", {
      Date: "2026-07-04",
      SubProgram: "TestShow", // linked to show-uuid-1
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Only the linked record results in an insert.
  assertEquals(insertedPayloads.length, 1);
  // The held count should be 1 (unlinked program).
  assertEquals(body.held, 1);
});

// ─── New-date detection: invokeFunction ──────────────────────────────────────

Deno.test("airtable-poll: new date → invokeFunction('open-offer-tier', { show_date_id, tier: 1 })", async () => {
  const { deps, invokeCalls } = makeHappyDeps({
    airtableRecords: [
      makeRecord("recNEW001", { Date: "2026-07-15", SubProgram: "TestShow" }),
    ],
  });

  // Override show_dates to make insert().select().single() return a new id.
  let insertCalled = false;
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        insertCalled = true;
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // Override single() to return our fake inserted id
        insertChain.single = () =>
          Promise.resolve({ data: { id: "new-date-uuid-001" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  // Verify totals shape
  assertEquals(typeof body.orgs_synced, "number");
  assertEquals(typeof body.processed, "number");
  assertEquals(typeof body.new_dates, "number");
  assertEquals(typeof body.updated, "number");
  assertEquals(typeof body.held, "number");
  assertEquals(typeof body.tiers_opened, "number");

  assertEquals(insertCalled, true, "insert should have been called");
  assertEquals(body.orgs_synced, 1);
  assertEquals(body.new_dates, 1);

  // invokeFunction should have been called with open-offer-tier
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 1);
  assertEquals((offerCalls[0].body as Record<string, unknown>).show_date_id, "new-date-uuid-001");
  assertEquals((offerCalls[0].body as Record<string, unknown>).tier, 1);
  assertEquals(body.tiers_opened, 1);
});

Deno.test("airtable-poll: existing date → update only, NO invokeFunction call", async () => {
  const updateArgs: unknown[] = [];

  const records = [
    makeRecord("recEXISTING", { Date: "2026-07-20", SubProgram: "TestShow" }),
  ];

  const { deps, invokeCalls } = makeHappyDeps({
    airtableRecords: records,
    existingShowDates: [{ id: "existing-uuid-001", airtable_record_id: "recEXISTING" }],
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => {
        updateArgs.push(payload);
        return (originalUpdate as (x: unknown) => ReturnType<typeof originalUpdate>)(payload);
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.new_dates, 0);

  // No offer-tier invocations for existing dates
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);

  // Update should have been called with the new date. session_1 is mapped, so it is
  // written on every update — null here (the record has no Session 1), which is how a
  // removed session clears in the DB.
  assertEquals(updateArgs.length >= 1, true, "update should have been called");
  const updatePayload = updateArgs[0] as Record<string, unknown>;
  assertEquals(updatePayload.date, "2026-07-20");
  assertEquals(updatePayload.session_1, null);
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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // All required fields (new totals shape — no `skipped`)
  assertEquals(typeof body.orgs_synced, "number");
  assertEquals(typeof body.processed, "number");
  assertEquals(typeof body.new_dates, "number");
  assertEquals(typeof body.updated, "number");
  assertEquals(typeof body.held, "number");
  assertEquals(typeof body.tiers_opened, "number");

  // One org ran but produced no records
  assertEquals(body.orgs_synced, 1);
  assertEquals(body.processed, 0);
  assertEquals(body.new_dates, 0);
  assertEquals(body.updated, 0);
  assertEquals(body.held, 0);
  assertEquals(body.tiers_opened, 0);
});

// ─── Batch resilience ─────────────────────────────────────────────────────────

Deno.test("airtable-poll: one invokeFunction rejection → others still run, still 200, partial tiers_opened", async () => {
  /**
   * Seed 3 new records. Override invokeFunction so the second one rejects.
   * Assert: response is 200, tiers_opened = 2 (not 3), processed = 3.
   */
  const newRecords = [
    makeRecord("recBATCH001", { Date: "2026-08-01", SubProgram: "TestShow" }),
    makeRecord("recBATCH002", { Date: "2026-08-02", SubProgram: "TestShow" }),
    makeRecord("recBATCH003", { Date: "2026-08-03", SubProgram: "TestShow" }),
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
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        const airtableId = p.airtable_record_id as string;
        insertOrder.push(airtableId);
        const uuid = recordToUuid[airtableId] ?? "uuid-unknown";
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () =>
          Promise.resolve({ data: { id: uuid }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

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

Deno.test("airtable-poll: Airtable API error → run still 200, org skipped (orgs_synced 0), error log row", async () => {
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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    // Return a non-ok response from Airtable
    fetchImpl: () =>
      Promise.resolve(
        new Response("Unauthorized", { status: 500 }),
      ) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  // syncOrg throws on the Airtable error; handle() catches + continues → still 200 (no throw out of handle()).
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // The one org failed before completing, so it's not counted as synced.
  assertEquals(body.orgs_synced, 0);
  // A visible error log row was written carrying org_id, before the throw.
  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.status, "error");
});

// ─── airtable_sync_log written ────────────────────────────────────────────────

Deno.test("airtable-poll: inserts a success row (with org_id + zero counts) into airtable_sync_log on clean run", async () => {
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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  assertEquals(syncLogInserts.length, 1, "airtable_sync_log should be written exactly once");
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.org_id, ORG);
  assertEquals(logRow.sync_type, "airtable_poll");
  assertEquals(logRow.status, "success");
  assertEquals(logRow.records_processed, 0);
  assertEquals(logRow.imported_count, 0);
  assertEquals(logRow.held_count, 0);
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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(new Response("Forbidden", { status: 500 })) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

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
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse([])) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { syncLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  await handle(authReq(), deps);
  assertEquals(syncLogInserts.length, 1);
  const logRow = syncLogInserts[0] as Record<string, unknown>;
  assertEquals(logRow.synced_at, fixedNow.toISOString());
});

// ─── Unlinked city is non-fatal + noted ───────────────────────────────────────

Deno.test("airtable-poll: unlinked city is non-fatal — record still imports with city_id null + a note", async () => {
  const insertedPayloads: unknown[] = [];
  const recordLogInserts: unknown[] = [];

  const records = [
    makeRecord("recCITYUNLINKED", {
      Date: "2026-09-09",
      SubProgram: "TestShow", // linked → show-uuid-1
      City: "Atlantis", // not in cities → unlinked
    }),
  ];

  const { deps } = makeHappyDeps({ airtableRecords: records });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        insertedPayloads.push(p);
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // Give the inserted row a stable id so it counts as a new date.
        insertChain.single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return insertChain;
      };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // The record STILL imports (unlinked city is non-fatal), with city_id null.
  assertEquals(insertedPayloads.length, 1);
  const payload = insertedPayloads[0] as Record<string, unknown>;
  assertEquals(payload.show_id, "show-uuid-1");
  assertEquals(payload.city_id, null);
  assertEquals(body.held, 0);
  assertEquals(body.new_dates, 1);

  // The per-record log row notes the city wasn't linked, with action imported_new.
  assertEquals(recordLogInserts.length, 1);
  const rows = recordLogInserts[0] as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.airtable_record_id === "recCITYUNLINKED");
  assertExists(row);
  assertEquals(row!.action, "imported_new");
  assertEquals(String(row!.reason).includes("Atlantis"), true, `reason should mention the unlinked city: ${row!.reason}`);
  assertEquals(String(row!.reason).includes("not linked"), true, `reason should note the city is not linked: ${row!.reason}`);
});

// ─── Held-set change → admin notification ──────────────────────────────────────

Deno.test("airtable-poll: a newly-held record notifies org admins (one notification per admin)", async () => {
  const notificationInserts: unknown[] = [];

  const records = [
    makeRecord("recNEWHELD", {
      Date: "2026-09-10",
      SubProgram: "NeverLinkedShow", // unlinked → held
    }),
  ];

  // Seed an admin recipient and an empty previous-run held set (prev log exists with held_count 0,
  // and the previous held-record select returns []), so this held record is NEW vs. the last run.
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null }, // prev-run held set is empty
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () => Promise.resolve(makeAirtableResponse(records)) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "notifications") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { notificationInserts.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.held, 1);

  // Exactly one notifications insert, carrying a row for admin-1 tied to this sync log.
  assertEquals(notificationInserts.length, 1, "admins should be notified exactly once");
  const rows = notificationInserts[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].user_id, "admin-1");
  assertEquals(rows[0].type, "airtable_sync_held");
  assertEquals(rows[0].related_entity_id, "log-1");
});

// ─── Interval gate (cron path) ────────────────────────────────────────────────

Deno.test("gate: first run (no prior poll) → polls", async () => {
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: null });
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(fetchSpy.count, 1);       // hit Airtable
  assertEquals(body.orgs_synced, 1);
});

Deno.test("gate: within interval → skipped, no Airtable call", async () => {
  // last poll 2 min before now(12:00); default interval 5 → 120s < 300s-60s=240s → skip
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:58:00.000Z" });
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(fetchSpy.count, 0);
  assertEquals(body.orgs_synced, 0);
});

Deno.test("gate: interval elapsed → polls", async () => {
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:50:00.000Z" }); // 10 min ago
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(fetchSpy.count, 1);
  assertEquals(body.orgs_synced, 1);
});

Deno.test("gate: sub-floor interval value is clamped to 5 min", async () => {
  // stored 1 → clamped to 5; last poll 2 min ago → still skipped
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:58:00.000Z", intervalMinutes: 1 });
  const res = await handle(authReq(), deps);
  await res.json();
  assertEquals(fetchSpy.count, 0);
});

Deno.test("gate: 60s grace lets a 5-min interval poll slightly early", async () => {
  // last poll 4m40s ago (280s); 300s-60s grace = 240s threshold; 280 ≥ 240 → poll
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:55:20.000Z", intervalMinutes: 5 });
  const res = await handle(authReq(), deps);
  await res.json();
  assertEquals(fetchSpy.count, 1);
});

// ─── Flow-gated tier-1 auto-open (Task 14) ────────────────────────────────────
// Auto-open is gated on the org's booking_flow (auto_open_tier1 && artist_acceptance)
// and additionally covers UPDATED dates that just gained a session but have no tier-1
// row yet. The booking_flow seed is disambiguated by `when: { key: "booking_flow" }`
// so it never shadows the base_id/table_name/field_map settings the poll also resolves.

Deno.test("airtable-poll: auto_open_tier1=false → no open-offer-tier invocations", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // booking_flow disables tier-1 auto-open for ORG.
        { when: { key: "booking_flow" }, data: [{ org_id: ORG, value: { auto_open_tier1: false } }] },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recNEW001", { Date: "2026-07-15", SubProgram: "TestShow" })]),
      ) as Promise<Response>,
  });

  // Give the inserted new date a real id so, WITHOUT the flow gate, tier 1 WOULD open.
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "new-date-uuid-001" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.new_dates, 1);

  // Gate is off → the batch never invokes open-offer-tier, tiers_opened is 0.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);
  assertEquals(body.tiers_opened, 0);
});

// The gate is `flow.auto_open_tier1 && flow.artist_acceptance`. The test above only
// covers the auto_open_tier1 half; this covers the other side of the AND, a
// direct-booking org (artist_acceptance: false) with auto-open otherwise ON.
Deno.test("airtable-poll: artist_acceptance=false (direct booking) → no open-offer-tier invocations", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // booking_flow keeps auto-open ON but the org has no offer/accept stage.
        { when: { key: "booking_flow" }, data: [{ org_id: ORG, value: { auto_open_tier1: true, artist_acceptance: false } }] },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recNEW002", { Date: "2026-07-16", SubProgram: "TestShow" })]),
      ) as Promise<Response>,
  });

  // Give the inserted new date a real id so, WITHOUT the flow gate, tier 1 WOULD open.
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "new-date-uuid-002" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.new_dates, 1);

  // Gate is off (artist_acceptance false) → the batch never invokes open-offer-tier.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);
  assertEquals(body.tiers_opened, 0);
});

// The gate is `flow.active && flow.auto_open_tier1 && flow.artist_acceptance`. The two
// tests above cover the auto_open_tier1 and artist_acceptance halves; this covers the
// master `active` switch — even with auto_open_tier1 and artist_acceptance both ON, a
// booking flow switched off (active: false) must suppress tier-1 auto-open entirely.
Deno.test("airtable-poll: booking_flow active=false → no open-offer-tier invocations", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // booking_flow is switched off for ORG, even though auto_open_tier1 and
        // artist_acceptance are both otherwise ON.
        { when: { key: "booking_flow" }, data: [{ org_id: ORG, value: { active: false, auto_open_tier1: true, artist_acceptance: true } }] },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recNEW003", { Date: "2026-07-17", SubProgram: "TestShow" })]),
      ) as Promise<Response>,
  });

  // Give the inserted new date a real id so, WITHOUT the active gate, tier 1 WOULD open.
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "new-date-uuid-003" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.new_dates, 1);

  // Gate is off (booking flow inactive) → the batch never invokes open-offer-tier.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);
  assertEquals(body.tiers_opened, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: module gate — booking_flow entitlement gates ONLY the tier-1 auto-open,
// not the date sync itself. syncOrg is shared by the cron fan-out AND the manual
// "Sync now" JWT path, so the gate lives inside syncOrg (checkFeature), not the
// getActiveOrgs()-level filter used by the digest crons.
//
// LOAD-BEARING: this is one of only two paths (the other is expire-offers'
// auto-escalation) where a service-role/cron caller can open an offer tier
// without ever going through the JWT-only requireFeature gate on
// open-offer-tier. resolveBookingFlow itself fails open to permissive defaults
// (auto_open_tier1: true) when the org is unentitled, so flow.auto_open_tier1
// alone is NOT a safe gate — the explicit checkFeature call is what actually
// closes this hole.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("airtable-poll LOAD-BEARING: unentitled org — date sync still runs, tier-1 auto-open is skipped", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      get_org_airtable_key: { data: "key", error: null },
      get_cron_secret: { data: "secret123", error: null },
      is_feature_enabled: { data: false, error: null },
    },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recNEW003", { Date: "2026-07-17", SubProgram: "TestShow" })]),
      ) as Promise<Response>,
  });

  // Give the inserted new date a real id so, WITHOUT the entitlement gate, tier 1 WOULD open
  // (flow.auto_open_tier1 defaults true, including resolveBookingFlow's own unentitled fallback).
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "new-date-uuid-003" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // The date sync runs regardless of entitlement.
  assertEquals(body.new_dates, 1);

  // LOAD-BEARING: tier-1 auto-open must be skipped for an unentitled org.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);
  assertEquals(body.tiers_opened, 0);
});

// Pin the fail-OPEN contract for booking_flow: a transient is_feature_enabled RPC
// error must never silently disable live production booking traffic.
Deno.test("airtable-poll: keeps auto-opening tier 1 when the entitlement RPC errors (booking_flow fails open)", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      get_org_airtable_key: { data: "key", error: null },
      get_cron_secret: { data: "secret123", error: null },
      is_feature_enabled: { data: null, error: { message: "boom" } },
    },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recNEW004", { Date: "2026-07-18", SubProgram: "TestShow" })]),
      ) as Promise<Response>,
  });

  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        insertChain.single = () => Promise.resolve({ data: { id: "new-date-uuid-004" }, error: null });
        return insertChain;
      };
    }
    return chain;
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.new_dates, 1);

  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 1, "booking_flow fails open on an is_feature_enabled RPC error");
  assertEquals(body.tiers_opened, 1);
});

Deno.test("airtable-poll: updated date with session and no tier-1 row is auto-opened", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // booking_flow default (empty rows) → normalized defaults: auto_open + acceptance on.
        { when: { key: "booking_flow" }, data: [] },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      // The record maps to an existing show_date → the update path (not insert).
      show_dates: { data: [{ id: "d-upd", airtable_record_id: "recUPD" }], error: null },
      // No tier-1 row yet for d-upd → the updated-with-session date becomes a candidate.
      show_date_offer_tiers: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recUPD", { Date: "2026-07-20", SubProgram: "TestShow", "Session 1": "T20:00:00" })]),
      ) as Promise<Response>,
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.updated, 1);
  assertEquals(body.new_dates, 0);

  // The updated date had a session and no tier-1 row → open-offer-tier is invoked for it.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 1);
  assertEquals((offerCalls[0].body as { show_date_id?: string }).show_date_id, "d-upd");
  assertEquals((offerCalls[0].body as { tier?: number }).tier, 1);
});

// The idempotency half of the updated-dates path: a date that ALREADY has a tier-1
// row is filtered out and never re-opened, even when its update gained a session.
Deno.test("airtable-poll: updated date with an existing tier-1 row is not re-opened", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        // booking_flow default (empty rows) → normalized defaults: auto_open + acceptance on.
        { when: { key: "booking_flow" }, data: [] },
        ...ENABLED_SETTINGS,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-uuid-berlin", airtable_city_key: "berlin" }], error: null },
      // The record maps to an existing show_date → the update path (not insert).
      show_dates: { data: [{ id: "d-upd", airtable_record_id: "recUPD" }], error: null },
      // Tier 1 was already opened for d-upd on an earlier poll.
      show_date_offer_tiers: { data: [{ show_date_id: "d-upd" }], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl: () =>
      Promise.resolve(
        makeAirtableResponse([makeRecord("recUPD", { Date: "2026-07-20", SubProgram: "TestShow", "Session 1": "T20:00:00" })]),
      ) as Promise<Response>,
  });

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.updated, 1);

  // The existing tier-1 row keeps the date out of the candidate list entirely.
  const offerCalls = invokeCalls.filter((c) => c.name === "open-offer-tier");
  assertEquals(offerCalls.length, 0);
  assertEquals(body.tiers_opened, 0);
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

Deno.test("airtable-poll: OPTIONS returns preflight (204)", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});
