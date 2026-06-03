import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps, makeRequest } from "./testing.ts";
import { requireRole, requireOrgRole, requireCronOrRole, isServiceRole, constantTimeEqual } from "./auth.ts";

Deno.test("requireRole rejects a request with no Bearer token (401)", async () => {
  const { deps } = makeFakeDeps();
  const out = await requireRole(deps, makeRequest({ headers: {} }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireRole rejects a valid user lacking the role (403)", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { user_roles: { data: null, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireRole accepts a user with the role and returns userId", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { user_roles: { data: { role: "admin" }, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin", "producer"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});

Deno.test("requireRole accepts a user whose role is in org_memberships (no user_roles row)", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { org_memberships: { data: { role: "admin" }, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});

Deno.test("requireRole falls back to legacy user_roles when org_memberships has no match", async () => {
  // org_memberships unseeded → no row; the user_roles fallback grants the role.
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { user_roles: { data: { role: "producer" }, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["producer"]);
  assertEquals(out.ok, true);
});

Deno.test("requireRole rejects when neither org_memberships nor user_roles match (403)", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { org_memberships: { data: null, error: null }, user_roles: { data: null, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireOrgRole rejects a request with no Bearer token (401)", async () => {
  const { deps } = makeFakeDeps();
  const out = await requireOrgRole(deps, makeRequest({ headers: {} }), "org-1", ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireOrgRole rejects a user with no membership row in the org (403)", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { org_memberships: { data: null, error: null } } });
  const out = await requireOrgRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), "org-1", ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireOrgRole accepts an org member holding the role and returns userId", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { org_memberships: { data: { role: "admin" }, error: null } } });
  const out = await requireOrgRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), "org-1", ["admin", "producer"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});

Deno.test("requireCronOrRole accepts a matching cron secret without a JWT", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "secret123" }, error: null } } });
  const out = await requireCronOrRole(deps, makeRequest({ headers: { "X-Cron-Secret": "secret123" } }), ["admin"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, null);
});

Deno.test("requireCronOrRole rejects a wrong cron secret (401)", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "secret123" }, error: null } } });
  const out = await requireCronOrRole(deps, makeRequest({ headers: { "X-Cron-Secret": "nope" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireCronOrRole rejects a wrong secret of the SAME length (401)", async () => {
  // "secret123" and "secret124" are both 9 chars — exercises the constant-time
  // compare's equal-length branch (timingSafeEqual must run and return false).
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "secret123" }, error: null } } });
  const out = await requireCronOrRole(deps, makeRequest({ headers: { "X-Cron-Secret": "secret124" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("constantTimeEqual: equal strings → true, unequal (same/diff length) → false", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false); // same length, differs
  assertEquals(constantTimeEqual("abc", "abcd"), false); // different length
  assertEquals(constantTimeEqual("", ""), true);
});

Deno.test("isServiceRole detects the service-role bearer token", () => {
  const { deps } = makeFakeDeps({ envVars: { SUPABASE_SERVICE_ROLE_KEY: "svc" } });
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer svc" } })), true);
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer other" } })), false);
});
