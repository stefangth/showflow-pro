import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const CALLER = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const auth = { Authorization: "Bearer jwt" };

function depsFor(targetMemberships: unknown) {
  return makeFakeDeps({
    authUser: { id: CALLER },
    tables: {
      // requireOrgRole reads the caller's admin row (eq user_id+org_id); the handler
      // then reads the TARGET's memberships (eq user_id only).
      org_memberships: [
        { when: { user_id: CALLER, org_id: ORG }, data: { role: "admin" } },
        { when: { user_id: TARGET }, data: targetMemberships },
      ],
      // Tombstone existence check for (ORG, TARGET).
      org_member_removals: { data: { org_id: ORG, user_id: TARGET } },
    },
  });
}

Deno.test("retains the account when the target still belongs to another org", async () => {
  const { deps, calls } = depsFor({ org_id: "bbbbbbbb-0000-0000-0000-000000000009" });
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { retained: true, reason: "other_memberships" });
  // No destructive calls fired.
  assertEquals(calls.some((c) => c.table === "rpc:admin_anonymize_removed_user"), false);
});

Deno.test("deletes the account when this was the target's last org", async () => {
  const { deps, calls } = depsFor(null);
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  assertEquals(calls.some((c) => c.table === "rpc:admin_anonymize_removed_user"), true);
});

Deno.test("returns not_removed when there is no tombstone", async () => {
  const deps = makeFakeDeps({
    authUser: { id: CALLER },
    tables: {
      org_memberships: [{ when: { user_id: CALLER, org_id: ORG }, data: { role: "admin" } }],
      org_member_removals: { data: null },
    },
  }).deps;
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 404);
});

Deno.test("rejects a non-admin caller", async () => {
  const deps = makeFakeDeps({
    authUser: { id: CALLER },
    tables: { org_memberships: { data: null }, platform_admins: { data: null } },
  }).deps;
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 403);
});

Deno.test("400 when the body is missing ids", async () => {
  const { deps } = depsFor(null);
  const res = await handle(makeRequest({ headers: auth, body: {} }), deps);
  assertEquals(res.status, 400);
});
