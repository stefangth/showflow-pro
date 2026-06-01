import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("handle-email-suppression: non-POST → 405", async () => {
  const { deps } = makeFakeDeps({ envVars: { RESEND_WEBHOOK_SECRET: "whsec_x" } });
  const res = await handle(makeRequest({ method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("handle-email-suppression: missing/invalid signature → 401", async () => {
  // All three env vars must be present to pass the config check and reach signature verification.
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are checked before the signature; omitting them
  // would short-circuit with 500 instead of 401.
  const { deps } = makeFakeDeps({
    envVars: {
      RESEND_WEBHOOK_SECRET: "whsec_x",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
    },
  });
  const res = await handle(makeRequest({ method: "POST", body: { type: "email.bounced" } }), deps);
  assertEquals(res.status, 401);
});
