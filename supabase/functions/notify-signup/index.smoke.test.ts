import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("notify-signup: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("notify-signup: missing approval record → 400", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ body: {} }), deps);
  assertEquals(res.status, 400);
});

Deno.test("notify-signup: pending signup notifies admins → 200", async () => {
  const { deps } = makeFakeDeps({
    usersById: { admin1: { email: "admin@example.com" } },
    tables: { user_roles: { data: [{ user_id: "admin1", role: "admin" }], error: null } },
  });
  const res = await handle(makeRequest({ body: { record: { id: "ap1", email: "new@x.com", display_name: "New", status: "pending" } } }), deps);
  assertEquals(res.status, 200);
});
