import { assertEquals } from "./test-asserts.ts";
import { corsHeaders, json, preflight } from "./http.ts";

Deno.test("json sets status, body, and CORS + content-type headers", async () => {
  const res = json({ ok: true }, 201);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { ok: true });
});

Deno.test("json defaults to status 200", () => {
  assertEquals(json({}).status, 200);
});

Deno.test("preflight returns a CORS 204 for OPTIONS", () => {
  const res = preflight();
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("corsHeaders allows the x-cron-secret header", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Headers"].includes("x-cron-secret"), true);
});
