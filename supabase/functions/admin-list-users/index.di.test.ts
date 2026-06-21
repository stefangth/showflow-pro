/**
 * Deep DI tests for admin-list-users handler.
 *
 * Contract under test (src: index.ts):
 *  - OPTIONS                              → 204 preflight
 *  - No Authorization header              → 401 { error: "Unauthorized" }
 *  - Valid JWT, not an admin of the org    → 403 { error: "Forbidden" }
 *  - Admin of the requested org           → 200 { users: [...] }
 *      · each user shaped as: { id, email, created_at, last_sign_in_at, roles: string[] }
 *      · users with org memberships have populated roles[]
 *      · users without memberships have roles: []
 *  - Admin of a DIFFERENT org (?org_id)    → 403 (cross-org roster read blocked)
 *  - Super-admin (no org role)            → 200 (platform_admins fallback)
 *  - listUsers called with page:1 / perPage:1000
 *  - empty auth store → 200 { users: [] }
 *
 * Authorization is org-scoped via requireOrgRole(org_id, ['admin']): roles are
 * read from org_memberships for the requested org (?org_id; default bootstrap).
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { BOOTSTRAP_ORG_ID } from "../_shared/constants.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function adminRequest(): Request {
  return makeRequest({ method: "GET", headers: { Authorization: "Bearer jwt" } });
}

// The FakeClientOptions.usersById type only declares `{ email?: string }` but the
// fake's listUsers() spreads all provided fields onto the returned user object.
// deno-lint-ignore no-explicit-any
type UsersById = Record<string, any>;

// Build deps where u1 is a valid admin caller. usersById feeds listUsers();
// org_memberships feeds both requireRole (the admin-caller check) and the role map.
function makeAdminDeps(
  extraUsers: UsersById,
  extraRoles: Array<{ user_id: string; role: string }>,
) {
  const usersById: UsersById = {
    u1: { email: "admin@test.com", created_at: "2025-01-01T00:00:00Z", last_sign_in_at: "2025-06-01T00:00:00Z" },
    ...extraUsers,
  };
  return makeFakeDeps({
    authUser: { id: "u1" },
    usersById: usersById as Record<string, { email?: string }>,
    tables: {
      org_memberships: {
        data: [
          { user_id: "u1", role: "admin" },
          ...extraRoles,
        ],
        error: null,
      },
    },
  });
}

// ── preflight ─────────────────────────────────────────────────────────────────

Deno.test("admin-list-users DI: OPTIONS returns preflight 204", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

// ── auth/authz guards ─────────────────────────────────────────────────────────

Deno.test("admin-list-users DI: missing Authorization header → 401", async () => {
  const { deps } = makeFakeDeps({ authUser: null });
  const res = await handle(makeRequest({ method: "GET", headers: {} }), deps);
  assertEquals(res.status, 401);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "Unauthorized");
});

Deno.test("admin-list-users DI: Authorization without Bearer prefix → 401", async () => {
  const { deps } = makeFakeDeps({ authUser: null });
  const res = await handle(
    makeRequest({ method: "GET", headers: { Authorization: "Basic dXNlcjpwYXNz" } }),
    deps,
  );
  assertEquals(res.status, 401);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "Unauthorized");
});

Deno.test("admin-list-users DI: valid JWT but role=producer → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u2" },
    tables: { org_memberships: { data: [{ user_id: "u2", role: "producer" }], error: null } },
    usersById: {},
  });
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 403);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "Forbidden");
});

Deno.test("admin-list-users DI: valid JWT but role=artist → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u3" },
    tables: { org_memberships: { data: [{ user_id: "u3", role: "artist" }], error: null } },
    usersById: {},
  });
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 403);
});

Deno.test("admin-list-users DI: valid JWT but no membership at all → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u4" },
    tables: { org_memberships: { data: [], error: null } },
    usersById: {},
  });
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 403);
});

// ── 200 happy-path: response structure ───────────────────────────────────────

Deno.test("admin-list-users DI: admin → 200 with { users } top-level key", async () => {
  const { deps } = makeAdminDeps({}, []);
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertExists(body.users);
  assertEquals(Array.isArray(body.users), true);
});

Deno.test("admin-list-users DI: user shape includes required fields (no approval_status)", async () => {
  const { deps } = makeAdminDeps(
    { u2: { email: "artist@test.com", created_at: "2025-02-01T00:00:00Z", last_sign_in_at: "2025-05-01T00:00:00Z" } },
    [{ user_id: "u2", role: "artist" }],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  assertExists(body.users);

  const u2 = body.users.find((u) => u.id === "u2");
  assertExists(u2);

  assertEquals(u2.id, "u2");
  assertEquals(u2.email, "artist@test.com");
  assertEquals(u2.created_at, "2025-02-01T00:00:00Z");
  assertEquals(u2.last_sign_in_at, "2025-05-01T00:00:00Z");
  assertEquals(u2.roles, ["artist"]);

  // The documented shape no longer carries approval_status.
  const knownKeys = new Set(["id", "email", "created_at", "last_sign_in_at", "roles"]);
  for (const k of Object.keys(u2)) {
    assertEquals(knownKeys.has(k), true, `Unexpected field in user shape: "${k}"`);
  }
});

Deno.test("admin-list-users DI: user without a membership row has roles: []", async () => {
  const { deps } = makeAdminDeps(
    { u5: { email: "norole@test.com", created_at: "2025-03-01T00:00:00Z", last_sign_in_at: null as unknown as string } },
    [],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  const u5 = body.users.find((u) => u.id === "u5");
  assertExists(u5);
  assertEquals(u5.roles, []);
});

Deno.test("admin-list-users DI: user with multiple roles has all roles in array", async () => {
  const { deps } = makeAdminDeps(
    { u7: { email: "multi@test.com", created_at: "2025-05-01T00:00:00Z" } },
    [
      { user_id: "u7", role: "producer" },
      { user_id: "u7", role: "artist" },
    ],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  const u7 = body.users.find((u) => u.id === "u7");
  assertExists(u7);
  const roles = u7.roles as string[];
  assertEquals(roles.includes("producer"), true);
  assertEquals(roles.includes("artist"), true);
  assertEquals(roles.length, 2);
});

// ── empty auth store ──────────────────────────────────────────────────────────

Deno.test("admin-list-users DI: admin with empty auth store → 200 { users: [] }", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: {},
    tables: { org_memberships: { data: [{ user_id: "u1", role: "admin" }], error: null } },
  });

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: unknown[] };
  assertEquals(body.users, []);
});

// ── pagination args characterization ─────────────────────────────────────────

Deno.test("admin-list-users DI: listUsers is called (pagination args not verified by fake)", async () => {
  const { deps } = makeAdminDeps(
    { u8: { email: "paged@test.com", created_at: "2025-06-01T00:00:00Z" } },
    [{ user_id: "u8", role: "artist" }],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  const u8 = body.users.find((u) => u.id === "u8");
  assertExists(u8);
});

// ── cross-org isolation (issue #110 broader audit) ────────────────────────────
//
// The roster is org-scoped via requireOrgRole(org_id) — an admin of org A can no
// longer pass ?org_id=<org B> and read org B's role roster. Mirrors the
// open/close-offer-tier fix from PR #109. The org_id is taken from the ?org_id
// query param (the app passes the caller's active org), defaulting to bootstrap.

Deno.test("admin-list-users DI: admin of another org → 403 (cross-org roster read blocked)", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // requireOrgRole(org-B): u1 has no membership row in org-B → fails. The
      // no-`when` fallback row would let an any-org requireRole pass, so this is
      // RED against the old code (200) and GREEN once org-scoped (403).
      org_memberships: [
        { when: { org_id: "org-B" }, data: null, error: null },
        { data: [{ user_id: "u1", role: "admin" }], error: null },
      ],
      platform_admins: { data: null, error: null },
    },
    usersById: { u9: { email: "roster@org-b.test" } },
  });
  const req = makeRequest({
    method: "GET",
    headers: { Authorization: "Bearer jwt" },
    url: "http://localhost/fn?org_id=org-B",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 403);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "Forbidden");
  // The org gate was evaluated against the REQUESTED org, not "any org".
  assertEquals(
    calls.some((c) =>
      c.table === "org_memberships" && c.method === "eq" && c.args[0] === "org_id" && c.args[1] === "org-B"
    ),
    true,
  );
});

Deno.test("admin-list-users DI: org_id from POST body is honored over the bootstrap default (app transport)", async () => {
  // The app invokes via functions.invoke({ body: { org_id } }) (house convention).
  // With no ?org_id query param, the body value must drive requireOrgRole — NOT the
  // bootstrap default. u1 is an admin of org-B only (not bootstrap), so reading the
  // body is what authorizes the call.
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: [
        { when: { org_id: BOOTSTRAP_ORG_ID }, data: null, error: null }, // not a bootstrap admin
        { when: { org_id: "org-B" }, data: [{ user_id: "u1", role: "admin" }], error: null },
      ],
      platform_admins: { data: null, error: null },
    },
    usersById: { u1: { email: "admin@org-b.test" } },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer jwt" }, body: { org_id: "org-B" } }),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("admin-list-users DI: super-admin (no org role) → 200 via platform_admins fallback", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: { data: [], error: null }, // u1 holds no org role anywhere
      platform_admins: { data: [{ user_id: "u1" }], error: null },
    },
    usersById: { u1: { email: "super@platform.test" }, u2: { email: "member@org-z.test" } },
  });
  const req = makeRequest({
    method: "GET",
    headers: { Authorization: "Bearer jwt" },
    url: "http://localhost/fn?org_id=org-Z",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: unknown[] };
  assertEquals(Array.isArray(body.users), true);
  assertEquals(body.users.length, 2);
});
