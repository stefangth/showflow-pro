import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { FEATURE_KEYS } from "../_shared/entitlements.ts";

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

// ---------------------------------------------------------------------------
// Task 9: seed org_entitlements from the platform default_entitlements setting
// at creation time. resolveOrgSetting reads app_settings via a `key`-matched
// array seed (mirrors the pattern used across the other booking-flow DI tests).
// ---------------------------------------------------------------------------

Deno.test("provision-org: seeds org_entitlements from the resolved default_entitlements setting", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      app_settings: [
        {
          when: { key: "default_entitlements" },
          data: [{ org_id: null, value: { booking_flow: true, hire_orders: true } }],
          error: null,
        },
      ],
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);

  const insertCall = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  assertEquals(insertCall !== undefined, true);
  const rows = insertCall!.args[0] as Array<{ org_id: string; feature: string; enabled: boolean }>;
  assertEquals(rows.length, FEATURE_KEYS.length);
  assertEquals(rows.every((r) => r.org_id === "org-9"), true);
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, true);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, true);
});

Deno.test("provision-org: falls back to registry defaults when default_entitlements is unset", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } }, // no app_settings row
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);

  const insertCall = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  assertEquals(insertCall !== undefined, true);
  const rows = insertCall!.args[0] as Array<{ org_id: string; feature: string; enabled: boolean }>;
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, true);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, false);
});
