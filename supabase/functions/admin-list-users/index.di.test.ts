/**
 * Deep DI tests for admin-list-users handler.
 *
 * Contract under test (src: index.ts):
 *  - OPTIONS                              → 204 preflight
 *  - No Authorization header              → 401 { error: "Unauthorized" }
 *  - Valid JWT but role != admin           → 403 { error: "Forbidden" }
 *  - Admin JWT                            → 200 { users: [...] }
 *      · each user shaped as:
 *          { id, email, created_at, last_sign_in_at, roles: string[], approval_status: string|null }
 *      · users with roles have populated roles[]
 *      · users without roles have roles: []
 *      · users with approval entry have approval_status set
 *      · users without approval entry have approval_status: null
 *  - listUsers called with page:1 / perPage:1000
 *  - empty auth store → 200 { users: [] }
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function adminRequest(): Request {
  return makeRequest({ method: "GET", headers: { Authorization: "Bearer jwt" } });
}

// The FakeClientOptions.usersById type only declares `{ email?: string }` but the
// fake's listUsers() spreads all provided fields onto the returned user object.
// We cast to the declared type at the boundary so TypeScript is satisfied while
// still passing the extra fields through at runtime.
// deno-lint-ignore no-explicit-any
type UsersById = Record<string, any>;

// Build deps where u1 is a valid admin caller.
// usersById feeds listUsers(); org_memberships feeds both requireRole (the
// admin-caller check) and the parallel fetch in the handler body.
function makeAdminDeps(
  extraUsers: UsersById,
  extraRoles: Array<{ user_id: string; role: string }>,
  extraApprovals: Array<{ user_id: string; status: string }>,
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
      user_approvals: { data: extraApprovals, error: null },
    },
  });
}

// ── preflight ─────────────────────────────────────────────────────────────────

Deno.test("admin-list-users DI: OPTIONS returns preflight 204", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
  // CORS header present
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
    tables: {
      org_memberships: { data: [{ user_id: "u2", role: "producer" }], error: null },
      user_approvals: { data: [], error: null },
    },
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
    tables: {
      org_memberships: { data: [{ user_id: "u3", role: "artist" }], error: null },
      user_approvals: { data: [], error: null },
    },
    usersById: {},
  });
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 403);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "Forbidden");
});

Deno.test("admin-list-users DI: valid JWT but no role row at all → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u4" },
    tables: {
      org_memberships: { data: [], error: null },
      user_approvals: { data: [], error: null },
    },
    usersById: {},
  });
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 403);
});

// ── 200 happy-path: response structure ───────────────────────────────────────

Deno.test("admin-list-users DI: admin → 200 with { users } top-level key", async () => {
  const { deps } = makeAdminDeps({}, [], []);
  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertExists(body.users);
  assertEquals(Array.isArray(body.users), true);
});

Deno.test("admin-list-users DI: user shape includes required fields", async () => {
  const { deps } = makeAdminDeps(
    {
      u2: { email: "artist@test.com", created_at: "2025-02-01T00:00:00Z", last_sign_in_at: "2025-05-01T00:00:00Z" },
    },
    [{ user_id: "u2", role: "artist" }],
    [{ user_id: "u2", status: "approved" }],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  assertExists(body.users);

  const u2 = body.users.find((u) => u.id === "u2");
  assertExists(u2);

  // Required shape fields
  assertEquals(u2.id, "u2");
  assertEquals(u2.email, "artist@test.com");
  assertEquals(u2.created_at, "2025-02-01T00:00:00Z");
  assertEquals(u2.last_sign_in_at, "2025-05-01T00:00:00Z");
  assertEquals(u2.roles, ["artist"]);
  assertEquals(u2.approval_status, "approved");

  // Must not contain extra unlisted fields beyond the documented shape
  const knownKeys = new Set(["id", "email", "created_at", "last_sign_in_at", "roles", "approval_status"]);
  for (const k of Object.keys(u2)) {
    assertEquals(knownKeys.has(k), true, `Unexpected field in user shape: "${k}"`);
  }
});

Deno.test("admin-list-users DI: user without role row has roles: []", async () => {
  const { deps } = makeAdminDeps(
    { u5: { email: "norole@test.com", created_at: "2025-03-01T00:00:00Z", last_sign_in_at: null as unknown as string } },
    [], // no extra role rows for u5
    [],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  const u5 = body.users.find((u) => u.id === "u5");
  assertExists(u5);
  assertEquals(u5.roles, []);
});

Deno.test("admin-list-users DI: user without approval row has approval_status: null", async () => {
  const { deps } = makeAdminDeps(
    { u6: { email: "noapproval@test.com", created_at: "2025-04-01T00:00:00Z" } },
    [{ user_id: "u6", role: "producer" }],
    [], // no approval row
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  const u6 = body.users.find((u) => u.id === "u6");
  assertExists(u6);
  assertEquals(u6.approval_status, null);
});

Deno.test("admin-list-users DI: user with multiple roles has all roles in array", async () => {
  const { deps } = makeAdminDeps(
    { u7: { email: "multi@test.com", created_at: "2025-05-01T00:00:00Z" } },
    [
      { user_id: "u7", role: "producer" },
      { user_id: "u7", role: "artist" },
    ],
    [{ user_id: "u7", status: "approved" }],
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
  // Admin u1 is the caller but usersById is empty, so listUsers returns no users.
  // However requireRole uses the admin client's org_memberships table, not listUsers.
  // So the gate still passes, and the body users list is empty.
  //
  // NOTE: The fake listUsers() ignores pagination args (page, perPage) entirely.
  // characterization: fake always returns all usersById entries regardless of
  // pagination parameters. Production behavior (page:1, perPage:1000) is not
  // exercised by this harness — the handler's listUsers call is documented as
  // page=1, perPage=1000 but the fake stub does not validate those args.
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: {}, // empty — listUsers returns { users: [] }
    tables: {
      org_memberships: { data: [{ user_id: "u1", role: "admin" }], error: null },
      user_approvals: { data: [], error: null },
    },
  });

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: unknown[] };
  assertEquals(body.users, []);
});

// ── pagination args characterization ─────────────────────────────────────────

Deno.test("admin-list-users DI: listUsers is called (pagination args not verified by fake)", async () => {
  // characterization: the handler calls admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  // but the fake testing harness's listUsers() accepts no arguments and ignores them entirely.
  // We can confirm the call happened by observing that the response contains the seeded users.
  // A production integration test would be required to verify page/perPage are correctly passed.
  const { deps } = makeAdminDeps(
    { u8: { email: "paged@test.com", created_at: "2025-06-01T00:00:00Z" } },
    [{ user_id: "u8", role: "artist" }],
    [],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };
  // u8 is present in the response, confirming listUsers was invoked
  const u8 = body.users.find((u) => u.id === "u8");
  assertExists(u8);
});

// ── approval status values ────────────────────────────────────────────────────

Deno.test("admin-list-users DI: approval_status reflects DB value (pending, approved, rejected)", async () => {
  const { deps } = makeAdminDeps(
    {
      ua: { email: "pending@test.com", created_at: "2025-01-01T00:00:00Z" },
      ub: { email: "approved@test.com", created_at: "2025-01-02T00:00:00Z" },
      uc: { email: "rejected@test.com", created_at: "2025-01-03T00:00:00Z" },
    },
    [],
    [
      { user_id: "ua", status: "pending" },
      { user_id: "ub", status: "approved" },
      { user_id: "uc", status: "rejected" },
    ],
  );

  const res = await handle(adminRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { users: Record<string, unknown>[] };

  const ua = body.users.find((u) => u.id === "ua");
  const ub = body.users.find((u) => u.id === "ub");
  const uc = body.users.find((u) => u.id === "uc");

  assertExists(ua); assertEquals(ua.approval_status, "pending");
  assertExists(ub); assertEquals(ub.approval_status, "approved");
  assertExists(uc); assertEquals(uc.approval_status, "rejected");
});
