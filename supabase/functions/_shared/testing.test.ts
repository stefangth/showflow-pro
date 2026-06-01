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
