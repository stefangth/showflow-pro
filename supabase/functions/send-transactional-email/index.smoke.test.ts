import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const env = { RESEND_API_KEY: "re_x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "svc" };

// send-transactional-email now requires the service-role bearer (isServiceRole gate).
const authedReq = (o: Parameters<typeof makeRequest>[0] = {}) =>
  makeRequest({ ...o, headers: { Authorization: "Bearer svc", ...(o.headers ?? {}) } });

Deno.test("send-transactional-email: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars: env });
  const res = await handle(authedReq({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("send-transactional-email: unknown template → 404", async () => {
  const { deps } = makeFakeDeps({ envVars: env });
  const res = await handle(authedReq({ method: "POST", body: { templateName: "does-not-exist", recipientEmail: "a@x.com" } }), deps);
  assertEquals(res.status, 404);
});

Deno.test("send-transactional-email: rejects a non-service-role caller (403)", async () => {
  const { deps } = makeFakeDeps({ envVars: env });
  // plain makeRequest (no service-role bearer) must be forbidden
  const res = await handle(makeRequest({ method: "POST", body: { templateName: "artist-offer-digest", recipientEmail: "a@x.com" } }), deps);
  assertEquals(res.status, 403);
});
