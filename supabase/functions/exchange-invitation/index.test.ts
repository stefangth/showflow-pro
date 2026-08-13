import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const TOKEN = "stable-token-that-must-stay-secret";
const APP_ORIGIN = "https://app.showflow.pro";

function depsFor(
  claim: { data: unknown; error: unknown },
  actionUrl = "https://auth.example/action",
) {
  const logs: string[] = [];
  const { deps, calls } = makeFakeDeps({
    rpcs: { claim_invitation_auth_exchange: claim },
    authUsersByEmail: { "invitee@example.com": { id: "u1" }, "claimed@example.com": { id: "u2" } },
    generateLinkResult: {
      data: { properties: { action_link: actionUrl } },
      error: null,
    },
  });
  return { deps, calls, logs };
}

async function captureErrors<T>(logs: string[], run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("exchange-invitation: OPTIONS returns the shared CORS preflight response", async () => {
  const { deps } = depsFor({ data: null, error: null });
  const response = await handle(new Request("http://local", { method: "OPTIONS" }), deps);
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("exchange-invitation: methods other than POST and OPTIONS return 405", async () => {
  const { deps, calls } = depsFor({ data: null, error: null });
  const response = await handle(new Request("http://local", { method: "GET" }), deps);
  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Allow"), "POST, OPTIONS");
  assertEquals(calls.length, 0);
});

Deno.test("exchange-invitation: invalid JSON and an empty token are rejected", async () => {
  const { deps, calls } = depsFor({ data: null, error: null });
  for (const raw of ["{", JSON.stringify({ token: "  ", app_origin: APP_ORIGIN })]) {
    const response = await handle(new Request("http://local", { method: "POST", body: raw }), deps);
    assertEquals(response.status, 400);
  }
  assertEquals(calls.length, 0);
});

Deno.test("exchange-invitation: unavailable claims return the stable 410 contract", async () => {
  const { deps } = depsFor({ data: { status: "unavailable" }, error: null });
  const response = await handle(request(), deps);
  assertEquals(response.status, 410);
  assertEquals(await body(response), { error: "Invitation unavailable" });
});

Deno.test("exchange-invitation: throttled claims return 429 and a rounded Retry-After", async () => {
  const { deps } = depsFor({ data: { status: "throttled", retry_after_seconds: 3.2 }, error: null });
  const response = await handle(request(), deps);
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "4");
  assertEquals(await body(response), { error: "Please wait before trying again", retry_after_seconds: 4 });
});

Deno.test("exchange-invitation: claim errors return a generic 500", async () => {
  const { deps } = depsFor({ data: null, error: { message: "database detail" } });
  const response = await handle(request(), deps);
  assertEquals(response.status, 500);
  assertEquals(await body(response), { error: "Internal error" });
});

Deno.test("exchange-invitation: a missing minted action link releases its exact claim before returning 500", async () => {
  const { deps, calls } = depsFor({
    data: { status: "ok", email: "invitee@example.com", claimed_at: "2026-08-12T09:00:00Z" },
    error: null,
  }, "");
  const response = await handle(request(), deps);
  assertEquals(response.status, 500);
  assertEquals(await body(response), { error: "Internal error" });
  assertEquals(calls.some((call) => call.table === "org_invitations" && call.method === "update"), true);
  assertEquals(calls.some((call) => call.table === "org_invitations" && call.method === "eq" && call.args[0] === "token" && call.args[1] === TOKEN), true);
  assertEquals(calls.some((call) => call.table === "org_invitations" && call.method === "eq" && call.args[0] === "last_auth_exchange_at" && call.args[1] === "2026-08-12T09:00:00Z"), true);
});

Deno.test("exchange-invitation: a thrown mint failure releases its exact claim before returning 500", async () => {
  const { deps, calls } = depsFor({
    data: { status: "ok", email: "invitee@example.com", claimed_at: "2026-08-12T09:00:00Z" },
    error: null,
  });
  deps.admin.auth.admin.generateLink = async () => ({ data: null, error: new Error("transient auth failure") }) as never;
  const response = await handle(request(), deps);
  assertEquals(response.status, 500);
  assertEquals(calls.some((call) => call.table === "org_invitations" && call.method === "update"), true);
});

Deno.test("exchange-invitation: success mints from the claimed email without exposing secrets", async () => {
  const { deps, calls, logs } = depsFor({
    data: { status: "ok", email: "claimed@example.com", claimed_at: "2026-08-12T09:00:00Z" },
    error: null,
  });
  const response = await captureErrors(logs, () => handle(request(), deps));
  assertEquals(response.status, 200);
  const responseBody = await body(response);
  assertEquals(responseBody, { action_url: "https://auth.example/action" });
  const mint = calls.find((call) => call.table === "auth.admin.generateLink");
  assertExists(mint);
  const mintArgs = mint.args[0] as { email: string; options: { redirectTo: string } };
  assertEquals(mintArgs.email, "claimed@example.com");
  assertEquals(mintArgs.options.redirectTo, `${APP_ORIGIN}/auth/callback?redirect=%2Faccept-invite`);
  const observable = `${JSON.stringify(responseBody)} ${logs.join(" ")}`;
  assertEquals(observable.includes(TOKEN), false);
  assertEquals(logs.some((line) => line.includes("claimed@example.com")), false);
  assertEquals(logs, []);
  assertEquals(calls.some((call) => call.table === "org_invitations" && call.method === "update"), false);
});

function request(): Request {
  return new Request("http://local", {
    method: "POST",
    body: JSON.stringify({ token: TOKEN, app_origin: APP_ORIGIN }),
  });
}
