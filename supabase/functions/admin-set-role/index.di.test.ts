/**
 * Deep DI tests for admin-set-role — asserts the full documented contract
 * (now org-scoped: roles live in org_memberships, keyed by (org_id, user_id, role)).
 *
 * Seeding notes
 * -------------
 * `requireOrgRole` (in _shared/auth.ts) calls:
 *   admin.from("org_memberships").select("role")
 *     .eq("user_id", user.id).eq("org_id", orgId).in("role", roles).limit(1).maybeSingle()
 * The fake's `maybeSingle` applies the localIn filter from testing.ts, so we seed
 * org_memberships as a SingleSeed `{ data: [...], error: null }` and the
 * .in("role",["admin"]) filter keeps only rows whose `role` is in that list.
 *
 * The last-admin guard calls:
 *   admin.from("org_memberships").select("*", { count:"exact", head:true })
 *     .eq("org_id", orgId).eq("role","admin")
 * and destructures `{ count }` from the result via the `.then()` path, so tests
 * seed `{ ..., count: N }` and the guard receives that value.
 *
 * With no body.org_id, the handler targets the bootstrap org, so writes are
 * asserted against BOOTSTRAP_ORG_ID.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { BOOTSTRAP_ORG_ID } from "../_shared/constants.ts";
import { handle } from "./index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a POST request with a valid admin bearer token. */
function adminReq(body: unknown): Request {
  return makeRequest({
    headers: { Authorization: "Bearer jwt" },
    body,
  });
}

/**
 * Build a makeFakeDeps seed that authenticates `u1` as an admin of the bootstrap org.
 * `org_memberships` seed is a single array of rows; the fake applies .in("role",["admin"])
 * filtering in maybeSingle(), so rows with other roles are excluded.
 */
function adminCallerSeed(extraRows: Array<{ user_id: string; org_id?: string; role: string }> = []) {
  return {
    authUser: { id: "u1" },
    tables: {
      org_memberships: {
        data: [{ user_id: "u1", org_id: BOOTSTRAP_ORG_ID, role: "admin" }, ...extraRows],
        error: null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// AUTH / gating
// ---------------------------------------------------------------------------

Deno.test("no Authorization header → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(
    makeRequest({ headers: {}, body: { user_id: "u2", role: "artist", action: "add" } }),
    deps,
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("valid JWT but not an admin of the org → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // u1 is only an 'artist' in the org — .in("role",["admin"]) excludes it → 403
      org_memberships: { data: [{ user_id: "u1", org_id: BOOTSTRAP_ORG_ID, role: "artist" }], error: null },
    },
  });
  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "add" }), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertExists(body.error);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

Deno.test("missing user_id → 400", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ role: "artist", action: "add" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("missing role → 400", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", action: "add" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("missing action → 400", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "artist" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("invalid action value → 400", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "grant" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("invalid role value → 400", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "superuser", action: "add" }), deps);
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// action='add'
// ---------------------------------------------------------------------------

Deno.test("action='add': inserts org_memberships row in the bootstrap org → 200 ok:true", async () => {
  const { deps, calls } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "add" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });

  // Assert that an insert was recorded on org_memberships with the exact payload
  const insertCall = calls.find((c) => c.table === "org_memberships" && c.method === "insert");
  assertExists(insertCall);
  assertEquals(insertCall.args[0], { org_id: BOOTSTRAP_ORG_ID, user_id: "u2", role: "artist" });
});

Deno.test("action='add': honors an explicit org_id", async () => {
  // Caller u1 is an admin (the fake doesn't filter by org_id, so the same admin
  // seed authorizes); assert the write targets the requested org.
  const { deps, calls } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "producer", action: "add", org_id: "org-xyz" }), deps);
  assertEquals(res.status, 200);
  const insertCall = calls.find((c) => c.table === "org_memberships" && c.method === "insert");
  assertExists(insertCall);
  assertEquals(insertCall.args[0], { org_id: "org-xyz", user_id: "u2", role: "producer" });
});

Deno.test("action='add': unique-violation error is swallowed (idempotent) → 200", async () => {
  /**
   * The fake client shares one seed per table name. Both the requireOrgRole
   * maybeSingle() read and the insert .then() resolve against the same
   * `org_memberships` seed. We cannot simultaneously seed a valid admin row (for
   * auth) AND a duplicate-key error (for the insert) via the static seed.
   *
   * Workaround: start with a valid admin seed (for auth to pass), then monkey-patch
   * the admin client's `.from()` to intercept the insert chain specifically and
   * override its `.then()` to return a duplicate-key error.
   */
  const { deps } = makeFakeDeps(adminCallerSeed());

  let insertCalled = false;
  // deno-lint-ignore no-explicit-any
  const adminAny = deps.admin as any;
  const originalFrom = adminAny.from.bind(adminAny);
  adminAny.from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = originalFrom(table);
    if (table === "org_memberships") {
      // deno-lint-ignore no-explicit-any
      const origInsert = chain.insert.bind(chain) as (row: any) => any;
      // deno-lint-ignore no-explicit-any
      chain.insert = (row: any) => {
        insertCalled = true;
        // deno-lint-ignore no-explicit-any
        const innerChain: any = origInsert(row);
        innerChain.then = (f: any) =>
          Promise.resolve({
            data: null,
            error: { message: "duplicate key value violates unique constraint" },
          }).then(f);
        return innerChain;
      };
    }
    return chain;
  };

  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "add" }), deps);
  assertEquals(res.status, 200);
  assertEquals(insertCalled, true);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test("action='add': non-unique insert error bubbles → 500", async () => {
  let insertCalled = false;
  const { deps } = makeFakeDeps(adminCallerSeed());
  // deno-lint-ignore no-explicit-any
  const adminAny2 = deps.admin as any;
  const originalFrom2 = adminAny2.from.bind(adminAny2);
  adminAny2.from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = originalFrom2(table);
    if (table === "org_memberships") {
      // deno-lint-ignore no-explicit-any
      const origInsert = chain.insert.bind(chain) as (row: any) => any;
      // deno-lint-ignore no-explicit-any
      chain.insert = (row: any) => {
        insertCalled = true;
        // deno-lint-ignore no-explicit-any
        const innerChain: any = origInsert(row);
        innerChain.then = (f: any) =>
          Promise.resolve({ data: null, error: { message: "foreign key violation" } }).then(f);
        return innerChain;
      };
    }
    return chain;
  };

  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "add" }), deps);
  assertEquals(res.status, 500);
  assertEquals(insertCalled, true);
});

// ---------------------------------------------------------------------------
// action='remove' — non-admin role
// ---------------------------------------------------------------------------

Deno.test("action='remove': deletes the correct org_memberships row → 200", async () => {
  const { deps, calls } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u3", role: "producer", action: "remove" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });

  // Assert delete was scoped by org_id, user_id, and role
  const eqCalls = calls.filter((c) => c.table === "org_memberships" && c.method === "eq");
  const hasOrgFilter = eqCalls.some((c) => c.args[0] === "org_id" && c.args[1] === BOOTSTRAP_ORG_ID);
  const hasUserIdFilter = eqCalls.some((c) => c.args[0] === "user_id" && c.args[1] === "u3");
  const hasRoleFilter = eqCalls.some((c) => c.args[0] === "role" && c.args[1] === "producer");
  assertEquals(hasOrgFilter, true);
  assertEquals(hasUserIdFilter, true);
  assertEquals(hasRoleFilter, true);

  const deleteCall = calls.find((c) => c.table === "org_memberships" && c.method === "delete");
  assertExists(deleteCall);
});

// ---------------------------------------------------------------------------
// action='remove' + role='admin' — prevent-last-admin guard (scoped to the org)
//
// The guard queries:
//   admin.from("org_memberships").select("*", { count:"exact", head:true })
//     .eq("org_id", orgId).eq("role","admin")
// and blocks if (count ?? 0) <= 1.
// ---------------------------------------------------------------------------

Deno.test("prevent-last-admin: only 1 admin remains in the org → remove blocked → 400", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // 1 admin row; count:1 tells the guard there is only one admin left
      org_memberships: { data: [{ user_id: "u1", org_id: BOOTSTRAP_ORG_ID, role: "admin" }], error: null, count: 1 },
    },
  });

  const res = await handle(adminReq({ user_id: "u1", role: "admin", action: "remove" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Cannot remove the last admin");
});

Deno.test("prevent-last-admin: 2 admins exist in the org → remove allowed → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // 2 admin rows; count:2 → guard condition (count <= 1) is false → allowed
      org_memberships: {
        data: [
          { user_id: "u1", org_id: BOOTSTRAP_ORG_ID, role: "admin" },
          { user_id: "u2", org_id: BOOTSTRAP_ORG_ID, role: "admin" },
        ],
        error: null,
        count: 2,
      },
    },
  });

  const res = await handle(adminReq({ user_id: "u2", role: "admin", action: "remove" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

// ---------------------------------------------------------------------------
// count-null guard: when the admin-count query errors, Supabase returns
// `{ count: null, error: {...} }`. The guard must surface an explicit
// "Could not verify admin count" 500 rather than misreading null as "0 admins".
// ---------------------------------------------------------------------------

Deno.test("prevent-last-admin: count query errors (count:null) → 500 'Could not verify admin count'", async () => {
  const { deps } = makeFakeDeps(adminCallerSeed());

  let countCalled = false;
  // deno-lint-ignore no-explicit-any
  const adminAny = deps.admin as any;
  const originalFrom = adminAny.from.bind(adminAny);
  adminAny.from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = originalFrom(table);
    if (table === "org_memberships") {
      // The count query is the one that chains .select("*", { count, head }).
      // deno-lint-ignore no-explicit-any
      const origSelect = chain.select.bind(chain) as (...a: any[]) => any;
      // deno-lint-ignore no-explicit-any
      chain.select = (...selArgs: any[]) => {
        // deno-lint-ignore no-explicit-any
        const inner: any = origSelect(...selArgs);
        const opts = selArgs[1] as { count?: string; head?: boolean } | undefined;
        if (opts?.head === true) {
          countCalled = true;
          inner.then = (f: any) =>
            Promise.resolve({
              data: null,
              count: null,
              error: { message: "schema cache miss" },
            }).then(f);
        }
        return inner;
      };
    }
    return chain;
  };

  const res = await handle(adminReq({ user_id: "u1", role: "admin", action: "remove" }), deps);
  assertEquals(res.status, 500);
  assertEquals(countCalled, true);
  const body = await res.json();
  assertEquals(body.error, "Could not verify admin count");
});
