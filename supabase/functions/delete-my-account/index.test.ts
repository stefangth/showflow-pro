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
  assertEquals(res.status, 409);
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

Deno.test("reports anonymize_failed and does not delete when anonymize errors", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: {
      sole_admin_orgs: { data: [], error: null },
      anonymize_user: { data: null, error: { message: "permission denied" } },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "anonymize_failed");
  assertEquals(body.success, undefined);
});

Deno.test("reports delete_failed when the auth delete errors", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: { sole_admin_orgs: { data: [], error: null }, anonymize_user: { data: null, error: null } },
    deleteUserResult: { data: null, error: { message: "auth down" } },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "delete_failed");
});
