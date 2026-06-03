import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("admin-decide-approval: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("admin-decide-approval: no auth → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: { approval_id: "ap1", decision: "approved", role: "artist" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("admin-decide-approval: admin approves → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      user_roles: { data: [{ user_id: "u1", role: "admin" }], error: null },
      user_approvals: { data: { id: "ap1", user_id: "u2", email: "artist@example.com", display_name: "Test Artist", status: "pending" }, error: null },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { approval_id: "ap1", decision: "approved", role: "artist" } }), deps);
  assertEquals(res.status, 200);
});
