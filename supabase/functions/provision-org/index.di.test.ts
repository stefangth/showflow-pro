import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const body = { name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" };

Deno.test("provision-org: 403 for non-super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 403);
});

Deno.test("provision-org: net-new admin → RPC + branded email with actionLink, returns org_id", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {}, // net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).org_id, "org-9");
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("provision-org: existing admin → branded email with NO actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } }, // existing
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, undefined);
});

Deno.test("provision-org: 409 on duplicate slug", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: null, error: { code: "23505", message: "duplicate key" } } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 409);
});
