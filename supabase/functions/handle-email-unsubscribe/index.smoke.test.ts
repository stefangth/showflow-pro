import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("handle-email-unsubscribe: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("handle-email-unsubscribe: GET without a token → 400", async () => {
  // No token in query string → short-circuits before DB lookup with 400
  const { deps } = makeFakeDeps({
    envVars: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key" },
    tables: { email_unsubscribe_tokens: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ method: "GET", url: "http://localhost/fn" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("handle-email-unsubscribe: GET with a valid token → 200", async () => {
  const { deps } = makeFakeDeps({
    envVars: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key" },
    tables: { email_unsubscribe_tokens: { data: { id: "t1", used_at: null, artist_id: "a1" }, error: null } },
  });
  const res = await handle(makeRequest({ method: "GET", url: "http://localhost/fn?token=t1" }), deps);
  assertEquals(res.status, 200);
});
