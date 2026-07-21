import { assertEquals, assertExists } from "./test-asserts.ts";
import { realDeps, serviceInvokeOptions } from "./deps.ts";

Deno.test("realDeps exposes the full Deps surface", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_ANON_KEY: "anon",
  };
  const deps = realDeps((k) => env[k]);
  assertExists(deps.admin);
  assertEquals(typeof deps.userClient, "function");
  assertEquals(typeof deps.env, "function");
  assertEquals(typeof deps.now, "function");
  assertEquals(typeof deps.invokeFunction, "function");
  assertEquals(typeof deps.sendEmail, "function");
  assertEquals(typeof deps.fetch, "function");
  assertEquals(deps.env("SUPABASE_ANON_KEY"), "anon");
  assertEquals(deps.now() instanceof Date, true);
});

Deno.test("serviceInvokeOptions attaches the service-role key as the Authorization bearer", () => {
  const opts = serviceInvokeOptions({ show_date_id: "sd-1", tier: 1 }, "svc-key-abc");
  assertEquals(opts.headers.Authorization, "Bearer svc-key-abc");
  assertEquals(opts.body, { show_date_id: "sd-1", tier: 1 });
});
