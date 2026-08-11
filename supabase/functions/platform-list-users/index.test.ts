import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer x" };

Deno.test("rejects non-super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("assembles per-user memberships + artist link", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      org_memberships: { data: [{ org_id: "o1", user_id: "u1", role: "artist" }], error: null },
      organizations: { data: [{ id: "o1", name: "Org One" }], error: null },
      artists: { data: [{ id: "a1", name: "Ada", user_id: "u1", org_id: "o1" }], error: null },
      profiles: { data: [{ user_id: "u1", display_name: "Ada L" }], error: null },
    },
    authUsers: [{ id: "u1", email: "u1@test.com", created_at: "2026-01-01", last_sign_in_at: null, banned_until: null }],
  });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.users[0].memberships[0].org_name, "Org One");
  assertEquals(body.users[0].memberships[0].artist.name, "Ada");
  assertEquals(body.users[0].memberships[0].invitePending, false);
});

Deno.test("flags a membership as pending when a matching pending invitation exists", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      org_memberships: { data: [
        { org_id: "o1", user_id: "u1", role: "artist" },
        { org_id: "o2", user_id: "u1", role: "producer" },
      ], error: null },
      organizations: { data: [{ id: "o1", name: "Org One" }, { id: "o2", name: "Org Two" }], error: null },
      artists: { data: [], error: null },
      profiles: { data: [], error: null },
      org_invitations: { data: [{ org_id: "o1", email: "U1@Test.com", status: "pending" }], error: null },
    },
    authUsers: [{ id: "u1", email: "u1@test.com", created_at: "2026-01-01", last_sign_in_at: null, banned_until: null }],
  });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  const mems = body.users[0].memberships as Array<{ org_id: string; invitePending: boolean }>;
  assertEquals(mems.find((m) => m.org_id === "o1")!.invitePending, true);
  assertEquals(mems.find((m) => m.org_id === "o2")!.invitePending, false);
});
