import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { handler, type ExchangeInvitationDeps } from "./index.ts";

const TOKEN = "stable-token-that-must-stay-secret";
const APP_ORIGIN = "https://app.showflow.pro";

function depsFor(
  claim: { data: unknown; error: unknown },
  actionUrl = "https://auth.example/action",
) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const logs: string[] = [];
  const deps: ExchangeInvitationDeps = {
    claimInvitation: async (token, cooldownSeconds) => {
      calls.push({ name: "claim", args: { token, cooldownSeconds } });
      return claim;
    },
    mintActionLink: async (args) => {
      calls.push({ name: "mint", args });
      return actionUrl;
    },
    logError: (...values) => logs.push(values.map(String).join(" ")),
  };
  return { deps, calls, logs };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("exchange-invitation: OPTIONS returns the shared CORS preflight response", async () => {
  const { deps } = depsFor({ data: null, error: null });
  const response = await handler(new Request("http://local", { method: "OPTIONS" }), deps);
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("exchange-invitation: invalid JSON and an empty token are rejected", async () => {
  const { deps, calls } = depsFor({ data: null, error: null });
  for (const raw of ["{", JSON.stringify({ token: "  ", app_origin: APP_ORIGIN })]) {
    const response = await handler(new Request("http://local", { method: "POST", body: raw }), deps);
    assertEquals(response.status, 400);
  }
  assertEquals(calls.length, 0);
});

Deno.test("exchange-invitation: unavailable claims return the stable 410 contract", async () => {
  const { deps } = depsFor({ data: { status: "unavailable" }, error: null });
  const response = await handler(request(), deps);
  assertEquals(response.status, 410);
  assertEquals(await body(response), { error: "Invitation unavailable" });
});

Deno.test("exchange-invitation: throttled claims return 429 and a rounded Retry-After", async () => {
  const { deps } = depsFor({ data: { status: "throttled", retry_after_seconds: 3.2 }, error: null });
  const response = await handler(request(), deps);
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "4");
  assertEquals(await body(response), { error: "Please wait before trying again", retry_after_seconds: 4 });
});

Deno.test("exchange-invitation: claim errors return a generic 500", async () => {
  const { deps } = depsFor({ data: null, error: { message: "database detail" } });
  const response = await handler(request(), deps);
  assertEquals(response.status, 500);
  assertEquals(await body(response), { error: "Internal error" });
});

Deno.test("exchange-invitation: a missing minted action link returns a generic 500", async () => {
  const { deps } = depsFor({ data: { status: "ok", email: "invitee@example.com" }, error: null }, "");
  const response = await handler(request(), deps);
  assertEquals(response.status, 500);
  assertEquals(await body(response), { error: "Internal error" });
});

Deno.test("exchange-invitation: success mints from the claimed email without exposing secrets", async () => {
  const { deps, calls, logs } = depsFor({ data: { status: "ok", email: "claimed@example.com" }, error: null });
  const response = await handler(request(), deps);
  assertEquals(response.status, 200);
  const responseBody = await body(response);
  assertEquals(responseBody, { action_url: "https://auth.example/action" });
  assertExists(calls.find((call) => call.name === "mint"));
  assertEquals(calls.find((call) => call.name === "mint")?.args, {
    email: "claimed@example.com",
    appOrigin: APP_ORIGIN,
  });
  const observable = `${JSON.stringify(responseBody)} ${logs.join(" ")}`;
  assertEquals(observable.includes(TOKEN), false);
  assertEquals(logs.some((line) => line.includes("claimed@example.com")), false);
  assertEquals(logs.some((line) => line.includes("https://auth.example/action")), false);
});

function request(): Request {
  return new Request("http://local", {
    method: "POST",
    body: JSON.stringify({ token: TOKEN, app_origin: APP_ORIGIN }),
  });
}
