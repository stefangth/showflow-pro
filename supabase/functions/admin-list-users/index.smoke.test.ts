import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("admin-list-users: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("admin-list-users: no auth → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "GET", headers: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("admin-list-users: admin JWT → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: {},
    tables: {
      // Same seed is used by requireRole (.maybeSingle → truthy array passes !roleRow check)
      // and by the parallel user_roles fetch (array is iterable).
      user_roles: { data: [{ user_id: "u1", role: "admin" }], error: null },
      user_approvals: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ method: "GET", headers: { Authorization: "Bearer jwt" } }), deps);
  assertEquals(res.status, 200);
});
