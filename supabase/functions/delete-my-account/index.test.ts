import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer user-jwt", "content-type": "application/json" };

Deno.test("blocks when the caller is the sole admin of an org", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: { sole_admin_orgs: { data: [{ org_id: "o1", org_name: "Acme" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.error, "last_admin");
  assertEquals(body.org_name, "Acme");
});

Deno.test("anonymizes then deletes the auth user on the happy path", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: { sole_admin_orgs: { data: [], error: null }, anonymize_user: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).success, true);
});

Deno.test("rejects an unauthenticated request", async () => {
  const { deps } = makeFakeDeps({ authUser: null });
  const res = await handle(makeRequest({ headers: { "content-type": "application/json" }, body: {} }), deps);
  assertEquals(res.status, 401);
});
