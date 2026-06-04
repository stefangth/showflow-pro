import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

Deno.test("resend-invitation: super-admin re-sends the invite email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("resend-invitation: opaque 403 for unknown invitation (no existence leak)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: null, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "nope" } }), deps);
  assertEquals(res.status, 403);
});

Deno.test("resend-invitation: 409 for a non-pending invitation", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "accepted" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1" } }), deps);
  assertEquals(res.status, 409);
});
