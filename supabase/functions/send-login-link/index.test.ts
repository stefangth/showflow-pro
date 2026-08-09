import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";
import type { EmailMessage } from "../_shared/deps.ts";

const CANON = "https://app.showflow.pro";
const post = (body: unknown) =>
  new Request("https://x/functions/v1/send-login-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The fake records email sends as invokeFunction("send-transactional-email", msg)
 *  entries in `invokeCalls`; project them back to the EmailMessage bodies. */
const emailsOf = (invokeCalls: Array<{ name: string; body: unknown }>): EmailMessage[] =>
  invokeCalls
    .filter((c) => c.name === "send-transactional-email")
    .map((c) => c.body as EmailMessage);

Deno.test("exists + slot allowed: mints magiclink and sends exactly one magic-link email", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
    rpcs: { claim_login_link_slot: { data: true } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  const sends = emailsOf(invokeCalls).filter((e) => e.template_name === "magic-link");
  assertEquals(sends.length, 1);
  const td = sends[0].templateData ?? {};
  assertEquals(td, { actionLink: td.actionLink }); // only actionLink
  assertEquals("org_id" in sends[0], false);

  const gen = calls.find((c) => c.table === "auth.admin.generateLink");
  const params = gen!.args[0] as { type: string; email: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect=%2Fdashboard"), true);
});

Deno.test("no account: 200 ok, no email, no throttle write", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUsersByEmail: {},
    rpcs: { claim_login_link_slot: { data: true } },
  });
  const res = await handle(post({ email: "ghost@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(emailsOf(invokeCalls).length, 0);
  assertEquals(calls.some((c) => c.table === "rpc:claim_login_link_slot"), false);
});

Deno.test("lookup fault: 500 generic, no email, no throttle call", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    rpcs: { get_user_id_by_email: { error: { message: "boom" } } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal error" });
  assertEquals(emailsOf(invokeCalls).length, 0);
  assertEquals(calls.some((c) => c.table === "rpc:claim_login_link_slot"), false);
});

Deno.test("throttled: 200 ok, no email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
    rpcs: { claim_login_link_slot: { data: false } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(emailsOf(invokeCalls).length, 0);
});

Deno.test("throttle RPC fault: 500 generic, no email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
    rpcs: { claim_login_link_slot: { error: { message: "boom" } } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(emailsOf(invokeCalls).length, 0);
});

Deno.test("generateLink transient failure: 500 generic, no email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
    rpcs: { claim_login_link_slot: { data: true } },
    generateLinkResult: { data: null, error: { message: "transient" } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal error" });
  assertEquals(emailsOf(invokeCalls).length, 0);
});

Deno.test("malformed body / bad email: 400, no lookup", async () => {
  const { deps, invokeCalls } = makeFakeDeps({});
  assertEquals((await handle(post({ email: "nope", app_origin: CANON }), deps)).status, 400);
  assertEquals(emailsOf(invokeCalls).length, 0);
});

Deno.test("foreign app_origin: 400, no mint, no email", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: "https://evil.example" }), deps);
  assertEquals(res.status, 400);
  assertEquals(calls.some((c) => c.table === "auth.admin.generateLink"), false);
  assertEquals(emailsOf(invokeCalls).length, 0);
});

Deno.test("localhost app_origin with prod APP_URL: accepted, redirect uses localhost", async () => {
  // APP_URL unset in makeFakeDeps => canonical is the prod default; :8080 must still be accepted.
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "user@x.com": { id: "uid-1" } },
    rpcs: { claim_login_link_slot: { data: true } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: "http://localhost:8080" }), deps);
  assertEquals(res.status, 200);
  const gen = calls.find((c) => c.table === "auth.admin.generateLink");
  const params = gen!.args[0] as { options: { redirectTo: string } };
  assertEquals(params.options.redirectTo.startsWith("http://localhost:8080/auth/callback"), true);
});

Deno.test("missing app_origin: 400", async () => {
  const { deps } = makeFakeDeps({ authUsersByEmail: { "user@x.com": { id: "uid-1" } } });
  assertEquals((await handle(post({ email: "user@x.com" }), deps)).status, 400);
});
