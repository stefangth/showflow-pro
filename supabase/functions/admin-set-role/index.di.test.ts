/**
 * Deep DI tests for admin-set-role — asserts the full documented contract.
 *
 * Seeding notes
 * -------------
 * `requireRole` (in _shared/auth.ts) calls:
 *   admin.from("user_roles").select("role").eq("user_id", user.id).in("role", roles).maybeSingle()
 * The fake's `maybeSingle` applies the localIn filter from testing.ts, so we seed
 * user_roles as a SingleSeed `{ data: [...], error: null }` and the .in("role",["admin"])
 * filter keeps only rows whose `role` is in that list.
 *
 * The last-admin guard calls:
 *   admin.from("user_roles").select("*", { count:"exact", head:true }).eq("role","admin")
 * and destructures `{ count }` from the result via the `.then()` path. The fake's
 * `SingleSeed` type now supports an optional `count` field (BUG-001 fix in testing.ts)
 * so tests can seed `{ ..., count: N }` and the guard will receive the correct value.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
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
 * Build a makeFakeDeps seed that authenticates `u1` as admin.
 * `user_roles` seed is a single array of rows; the fake applies .in("role",["admin"])
 * filtering in maybeSingle(), so rows with other roles are excluded.
 */
function adminCallerSeed(extraRoles: Array<{ user_id: string; role: string }> = []) {
  return {
    authUser: { id: "u1" },
    tables: {
      user_roles: {
        data: [{ user_id: "u1", role: "admin" }, ...extraRoles],
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

Deno.test("valid JWT but not admin → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // u1 has only 'artist' role — .in("role",["admin"]) filter excludes it → no roleRow → 403
      user_roles: { data: [{ user_id: "u1", role: "artist" }], error: null },
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

Deno.test("action='add': inserts user_roles row → 200 ok:true", async () => {
  const { deps, calls } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u2", role: "artist", action: "add" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });

  // Assert that an insert was recorded on user_roles with the exact payload
  const insertCall = calls.find((c) => c.table === "user_roles" && c.method === "insert");
  assertExists(insertCall);
  assertEquals(insertCall.args[0], { user_id: "u2", role: "artist" });
});

Deno.test("action='add': unique-violation error is swallowed (idempotent) → 200", async () => {
  /**
   * characterization: The fake client shares one seed per table name. Both the
   * requireRole maybeSingle() read and the insert .then() resolve against the
   * same `user_roles` seed. We cannot simultaneously seed a valid admin row (for
   * auth) AND a duplicate-key error (for the insert) via the static seed.
   *
   * Workaround: start with a valid admin seed (for auth to pass), then monkey-patch
   * the admin client's `.from()` to intercept the insert chain specifically and
   * override its `.then()` to return a duplicate-key error. This verifies the
   * /duplicate|unique/i regex swallow path without touching the auth path.
   */
  const { deps } = makeFakeDeps(adminCallerSeed());

  let insertCalled = false;
  // deno-lint-ignore no-explicit-any
  const adminAny = deps.admin as any;
  const originalFrom = adminAny.from.bind(adminAny);
  adminAny.from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = originalFrom(table);
    if (table === "user_roles") {
      // deno-lint-ignore no-explicit-any
      const origInsert = chain.insert.bind(chain) as (row: any) => any;
      // deno-lint-ignore no-explicit-any
      chain.insert = (row: any) => {
        insertCalled = true;
        // deno-lint-ignore no-explicit-any
        const innerChain: any = origInsert(row);
        // Override .then() to return a duplicate-key error for this insert
        // deno-lint-ignore no-explicit-any
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
  // A non-duplicate/unique error must NOT be swallowed — it should propagate as 500
  let insertCalled = false;
  const { deps } = makeFakeDeps(adminCallerSeed());
  // deno-lint-ignore no-explicit-any
  const adminAny2 = deps.admin as any;
  const originalFrom2 = adminAny2.from.bind(adminAny2);
  adminAny2.from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = originalFrom2(table);
    if (table === "user_roles") {
      // deno-lint-ignore no-explicit-any
      const origInsert = chain.insert.bind(chain) as (row: any) => any;
      // deno-lint-ignore no-explicit-any
      chain.insert = (row: any) => {
        insertCalled = true;
        // deno-lint-ignore no-explicit-any
        const innerChain: any = origInsert(row);
        // deno-lint-ignore no-explicit-any
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

Deno.test("action='remove': deletes the correct user_roles row → 200", async () => {
  const { deps, calls } = makeFakeDeps(adminCallerSeed());
  const res = await handle(adminReq({ user_id: "u3", role: "producer", action: "remove" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });

  // Assert delete was recorded on user_roles with eq("user_id","u3") and eq("role","producer")
  const eqCalls = calls.filter((c) => c.table === "user_roles" && c.method === "eq");
  const hasUserIdFilter = eqCalls.some((c) => c.args[0] === "user_id" && c.args[1] === "u3");
  const hasRoleFilter = eqCalls.some((c) => c.args[0] === "role" && c.args[1] === "producer");
  assertEquals(hasUserIdFilter, true);
  assertEquals(hasRoleFilter, true);

  const deleteCall = calls.find((c) => c.table === "user_roles" && c.method === "delete");
  assertExists(deleteCall);
});

// ---------------------------------------------------------------------------
// action='remove' + role='admin' — prevent-last-admin guard
//
// The guard queries:
//   admin.from("user_roles").select("*", { count:"exact", head:true }).eq("role","admin")
// and blocks if (count ?? 0) <= 1.
//
// BUG-001 (FIXED): The fake client's `.then()` path previously returned only
// `{ data, error }`, so `count` was always `undefined` → `(0 <= 1)` → the guard
// always fired and blocked any admin removal, even when multiple admins existed.
//
// Fix: `SingleSeed` in testing.ts now supports an optional `count` field which
// `resolveSeed` and `.then()` propagate through. Tests seed `count: N` accordingly.
// ---------------------------------------------------------------------------

Deno.test("prevent-last-admin: only 1 admin remains → remove blocked → 400", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // 1 admin row; count:1 tells the guard there is only one admin left
      user_roles: { data: [{ user_id: "u1", role: "admin" }], error: null, count: 1 },
    },
  });

  const res = await handle(adminReq({ user_id: "u1", role: "admin", action: "remove" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Cannot remove the last admin");
});

Deno.test("prevent-last-admin: 2 admins exist → remove allowed → 200", async () => {
  // Regression guard for BUG-001: with count:2 seeded, the guard must NOT block.
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      // 2 admin rows; count:2 → guard condition (count <= 1) is false → allowed
      user_roles: {
        data: [{ user_id: "u1", role: "admin" }, { user_id: "u2", role: "admin" }],
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
// BUG-002 (count-null guard): when the admin-count query errors, Supabase
// returns `{ count: null, error: {...} }`. The guard must NOT misread this as
// "0 admins" (which would block every removal with a misleading message) — it
// must surface an explicit "Could not verify admin count" 500.
//
// The `user_roles` seed is shared between the requireRole auth read and the
// count query, so we monkey-patch only the count query's `.then()` to return a
// null count + error (mirroring the duplicate-key insert test pattern above).
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
    if (table === "user_roles") {
      // The count query is the one that chains .select("*", { count, head }).
      // Intercept .select() with a count option and override its .then().
      // deno-lint-ignore no-explicit-any
      const origSelect = chain.select.bind(chain) as (...a: any[]) => any;
      // deno-lint-ignore no-explicit-any
      chain.select = (...selArgs: any[]) => {
        // deno-lint-ignore no-explicit-any
        const inner: any = origSelect(...selArgs);
        const opts = selArgs[1] as { count?: string; head?: boolean } | undefined;
        if (opts?.head === true) {
          countCalled = true;
          // deno-lint-ignore no-explicit-any
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
