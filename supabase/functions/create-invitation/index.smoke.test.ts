import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("create-invitation: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("create-invitation: no auth → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(
    makeRequest({ headers: {}, body: { org_id: "org-1", email: "x@y.com", role: "producer" } }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("create-invitation: org admin → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org-1", email: "x@y.com", role: "producer", status: "pending", token: "tok", expires_at: "2099-01-01" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { org_id: "org-1", email: "x@y.com", role: "producer" } }),
    deps,
  );
  assertEquals(res.status, 200);
});
