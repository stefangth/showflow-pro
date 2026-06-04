import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireSuperAdmin } from "./auth.ts";
import { makeFakeDeps, makeRequest } from "./testing.ts";

Deno.test("requireSuperAdmin: 401 without bearer", async () => {
  const { deps } = makeFakeDeps({});
  const out = await requireSuperAdmin(deps, makeRequest({ headers: {} }));
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireSuperAdmin: 403 when not a platform admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const out = await requireSuperAdmin(deps, makeRequest({ headers: { Authorization: "Bearer x" } }));
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireSuperAdmin: ok for a platform admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
  });
  const out = await requireSuperAdmin(deps, makeRequest({ headers: { Authorization: "Bearer x" } }));
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});
