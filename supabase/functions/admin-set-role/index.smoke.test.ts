import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("admin-set-role: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("admin-set-role: no auth → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: { user_id: "u2", role: "artist", action: "add" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("admin-set-role: admin adds a role → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: [{ user_id: "u1", role: "admin" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { user_id: "u2", role: "artist", action: "add" } }), deps);
  assertEquals(res.status, 200);
});
