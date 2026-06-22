import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer jwt", "content-type": "application/json" };

Deno.test("super-admin gets an org bundle", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      organizations: { data: [{ id: "o1", name: "Acme" }], error: null },
      org_memberships: { data: [], error: null },
      artists: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      bookings: { data: [], error: null },
      booking_audit_log: { data: [], error: null },
      chats: { data: [], error: null },
      chat_messages: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.bundle.schema_version, 1);
  assertEquals(body.bundle.organizations[0].name, "Acme");
});

Deno.test("non-super-admin is forbidden", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { platform_admins: { data: null, error: null } } });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 403);
});
