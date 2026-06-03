import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("preview-transactional-email: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("preview-transactional-email: no auth → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("preview-transactional-email: admin JWT → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { user_roles: { data: [{ user_id: "u1", role: "admin" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer jwt" }, body: {} }), deps);
  assertEquals(res.status, 200);
});
