import { assertEquals } from "./test-asserts.ts";
import { createFakeClient, makeFakeDeps, makeRequest } from "./testing.ts";

Deno.test("fake client resolves seeded table + records calls", async () => {
  const { client, calls } = createFakeClient({ tables: { user_roles: { data: { role: "admin" }, error: null } } });
  const res = await client.from("user_roles").select("role").eq("user_id", "u1").maybeSingle();
  assertEquals(res, { data: { role: "admin" }, error: null });
  assertEquals(calls[0], { table: "user_roles", method: "from", args: [] });
});

Deno.test("fake client resolves seeded rpc", async () => {
  const { client } = createFakeClient({ rpcs: { my_rpc: { data: [1], error: null } } });
  assertEquals(await client.rpc("my_rpc", { a: 1 }), { data: [1], error: null });
});

Deno.test("fake admin.auth.getUser returns the seeded user", async () => {
  const { client } = createFakeClient({ authUser: { id: "u9" } });
  const { data } = await client.auth.getUser();
  assertEquals(data.user, { id: "u9" });
});

Deno.test("makeFakeDeps wires env, now, and records invokeFunction calls", async () => {
  const fixedNow = new Date("2026-06-01T17:00:00.000Z");
  const { deps, invokeCalls } = makeFakeDeps({ envVars: { SUPABASE_URL: "x" }, now: fixedNow });
  assertEquals(deps.env("SUPABASE_URL"), "x");
  assertEquals(deps.now().getTime(), fixedNow.getTime());
  await deps.sendEmail({ template_name: "t", recipient_email: "e@x.com" });
  assertEquals(invokeCalls[0].name, "send-transactional-email");
});

Deno.test("makeRequest builds a Request with headers + JSON body", async () => {
  const req = makeRequest({ method: "POST", headers: { "X-Cron-Secret": "s" }, body: { a: 1 } });
  assertEquals(req.method, "POST");
  assertEquals(req.headers.get("X-Cron-Secret"), "s");
  assertEquals(await req.json(), { a: 1 });
});

Deno.test("fake client: array seed returns the entry whose `when` matches the recorded eq() args", async () => {
  const { client } = createFakeClient({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" }, error: null },
        { when: { key: "sub_program_slots_defaults" }, data: { value: { t: {} } }, error: null },
      ],
    },
  });
  const a = await client.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  const b = await client.from("app_settings").select("value").eq("key", "sub_program_slots_defaults").maybeSingle();
  assertEquals(a, { data: { value: "s" }, error: null });
  assertEquals(b, { data: { value: { t: {} } }, error: null });
});

Deno.test("fake client: array seed falls back to an entry with no `when` (default)", async () => {
  const { client } = createFakeClient({
    tables: { bookings: [{ when: { status: "suggested" }, data: [1], error: null }, { data: [], error: null }] },
  });
  const hit = await client.from("bookings").select("*").eq("status", "suggested");
  const miss = await client.from("bookings").select("*").eq("status", "confirmed");
  assertEquals(hit, { data: [1], error: null });
  assertEquals(miss, { data: [], error: null });
});

Deno.test("fake client: single-object seed still works (backward compatible)", async () => {
  const { client } = createFakeClient({ tables: { artists: { data: { id: "a1" }, error: null } } });
  assertEquals(await client.from("artists").select("*").eq("id", "a1").maybeSingle(), { data: { id: "a1" }, error: null });
});
