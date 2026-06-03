import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("notify-signup: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

const WEBHOOK_SECRET = "wh-secret-123";
const authHeaders = { "x-supabase-webhook-secret": WEBHOOK_SECRET };
const authEnv = { SUPABASE_WEBHOOK_SECRET: WEBHOOK_SECRET };

Deno.test("notify-signup: missing approval record → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: authEnv });
  const res = await handle(makeRequest({ headers: authHeaders, body: {} }), deps);
  assertEquals(res.status, 400);
});

Deno.test("notify-signup: pending signup notifies admins → 200", async () => {
  const { deps } = makeFakeDeps({
    envVars: authEnv,
    usersById: { admin1: { email: "admin@example.com" } },
    tables: { user_roles: { data: [{ user_id: "admin1", role: "admin" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: authHeaders, body: { record: { id: "ap1", email: "new@x.com", display_name: "New", status: "pending" } } }), deps);
  assertEquals(res.status, 200);
});
