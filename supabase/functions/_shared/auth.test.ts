import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps, makeRequest } from "./testing.ts";
import { requireRole, requireCronOrRole, isServiceRole } from "./auth.ts";

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

Deno.test("isServiceRole detects the service-role bearer token", () => {
  const { deps } = makeFakeDeps({ envVars: { SUPABASE_SERVICE_ROLE_KEY: "svc" } });
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer svc" } })), true);
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer other" } })), false);
});
