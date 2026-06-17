/**
 * DI tests for the airtable-schema handler.
 *
 * Coverage (Task 1 — guards + list-bases mode):
 *  - OPTIONS preflight
 *  - missing org_id → 400
 *  - no Bearer → 401; non-admin → 403 (via requireOrgRole)
 *  - no Vault key → 400, no Airtable fetch
 *  - list bases: correct URL, Bearer carries the Vault key, permissionLevel "none" filtered,
 *    offset pagination, PAT never leaked to the client
 *  - Airtable 403 → { schemaAccessible: false }; 401 → bad-key error (400)
 */
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const PAT = "pat-secret-DONOTLEAK";

/** Deps with an admin caller of ORG and a Vault key (override key/fetch as needed). */
function adminDeps(opts: { rpcKey?: string | null; fetchImpl?: typeof fetch } = {}) {
  const { rpcKey = PAT, fetchImpl } = opts;
  return makeFakeDeps({
    authUser: { id: ADMIN },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      platform_admins: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: rpcKey, error: null } },
    fetchImpl,
  });
}

/** An admin-authenticated POST with the given JSON body. */
function adminReq(body: Record<string, unknown> = { org_id: ORG }) {
  return makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body });
}

function airtableJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

// ─── Guards ───────────────────────────────────────────────────────────────────

Deno.test("airtable-schema: OPTIONS → preflight", async () => {
  const { deps } = adminDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("airtable-schema: missing org_id → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: {} }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("airtable-schema: no Bearer → 401", async () => {
  const { deps } = adminDeps();
  const res = await handle(makeRequest({ method: "POST", body: { org_id: ORG } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("airtable-schema: non-admin (no membership, not super-admin) → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-non-admin" },
    tables: {
      org_memberships: { data: null, error: null },
      platform_admins: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: PAT, error: null } },
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 403);
});

Deno.test("airtable-schema: no Vault key → 400, no Airtable fetch", async () => {
  let fetched = 0;
  const { deps } = adminDeps({
    rpcKey: null,
    fetchImpl: () => { fetched++; return Promise.resolve(airtableJson({})) as Promise<Response>; },
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 400);
  assertEquals(fetched, 0);
});

// ─── List bases ─────────────────────────────────────────────────────────────────

Deno.test("airtable-schema: lists bases (filters permissionLevel none), Vault key in Bearer, never leaked", async () => {
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = (url, init) => {
    captured.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(airtableJson({
      bases: [
        { id: "appAAA", name: "Fever Berlin", permissionLevel: "create" },
        { id: "appBBB", name: "Interface Only", permissionLevel: "none" },
      ],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, true);
  // permissionLevel "none" base is filtered out
  assertEquals(body.bases, [{ id: "appAAA", name: "Fever Berlin" }]);
  // exactly one fetch, correct URL + Authorization header carrying the Vault key
  assertEquals(captured.length, 1);
  assertEquals(captured[0].url, "https://api.airtable.com/v0/meta/bases");
  assertEquals((captured[0].init.headers as Record<string, string>)["Authorization"], `Bearer ${PAT}`);
  // the PAT never reaches the client
  assertEquals(JSON.stringify(body).includes(PAT), false);
});

Deno.test("airtable-schema: list bases follows offset pagination and concatenates pages", async () => {
  const urls: string[] = [];
  let call = 0;
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    call += 1;
    if (call === 1) {
      return Promise.resolve(airtableJson({
        bases: [{ id: "app1", name: "One", permissionLevel: "edit" }],
        offset: "page2tok",
      })) as Promise<Response>;
    }
    return Promise.resolve(airtableJson({
      bases: [{ id: "app2", name: "Two", permissionLevel: "edit" }],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  const body = await res.json();
  assertEquals(body.bases, [{ id: "app1", name: "One" }, { id: "app2", name: "Two" }]);
  assertEquals(urls.length, 2);
  assertEquals(urls[1].includes("offset=page2tok"), true);
});

Deno.test("airtable-schema: Airtable 403 (missing scope) → { schemaAccessible: false }", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ error: { type: "INSUFFICIENT_PERMISSIONS" } }, 403)) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, false);
  assertEquals("bases" in body, false);
});

Deno.test("airtable-schema: Airtable 401 (bad PAT) → 400 error", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("Unauthorized", { status: 401 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 400);
  assertExists((await res.json()).error);
});

// ─── Describe base (tables + fields) ─────────────────────────────────────────────

Deno.test("airtable-schema: describe base → tables + fields with options, correct URL", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    // Mirrors the real German base (Datum / Program / 1. Show) per spec §3.
    return Promise.resolve(airtableJson({
      tables: [{
        id: "tblEvents",
        name: "Events",
        primaryFieldId: "fldDate",
        fields: [
          { id: "fldDate", name: "Datum", type: "date" },
          { id: "fldProg", name: "Program", type: "singleSelect", options: { choices: [{ id: "selA", name: "TJE: Murder", color: "blueLight2" }] } },
          { id: "fldShow1", name: "1. Show", type: "singleLineText" },
        ],
        views: [{ id: "viwGrid", name: "Grid view", type: "grid" }],
      }],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appKg8xpplxd49Bo6" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, true);
  // correct describe-base URL (not the list-bases URL)
  assertEquals(urls[0], "https://api.airtable.com/v0/meta/bases/appKg8xpplxd49Bo6/tables");
  assertEquals(body.tables.length, 1);
  assertEquals(body.tables[0].id, "tblEvents");
  assertEquals(body.tables[0].name, "Events");
  assertEquals(body.tables[0].fields.length, 3);
  // field shape is exactly { id, name, type } when no options are present
  assertEquals(body.tables[0].fields[0], { id: "fldDate", name: "Datum", type: "date" });
  // singleSelect options.choices are preserved verbatim (needed later for option-linking + §14)
  assertEquals(body.tables[0].fields[1].options.choices[0].name, "TJE: Murder");
  // the table's `views` are dropped — not part of our contract
  assertEquals("views" in body.tables[0], false);
});

Deno.test("airtable-schema: describe base 403 (missing scope) → { schemaAccessible: false }", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("", { status: 403 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appXXX" }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).schemaAccessible, false);
});

Deno.test("airtable-schema: describe base never leaks the PAT", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ tables: [] })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appXXX" }), deps);
  assertEquals(JSON.stringify(await res.json()).includes(PAT), false);
});

Deno.test("airtable-schema: non-403/401 Airtable error → 502 with detail", async () => {
  // Covers the airtableFailure 502 branch (now serving both modes). List-bases mode.
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("Service Unavailable", { status: 503 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(body.detail, "Service Unavailable");
});
