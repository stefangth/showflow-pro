import { assertEquals } from "./test-asserts.ts";
import { ensureInvitedUser, sendOrgInvitationEmail } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const APP_ORIGIN = "http://localhost:8080"; // allowlisted by safeAppOrigin so it flows through unchanged

Deno.test("ensureInvitedUser: existing user → magic link to /auth/callback + id", async () => {
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } }, // existing (resolved via get_user_id_by_email)
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  const r = await ensureInvitedUser(deps, { email: "known@x.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "u9");
  assertEquals(r.actionLink, "https://link.example/magic");
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect="), true);
  assertEquals(params.options.redirectTo.includes("%2Faccept-invite%3Ftoken%3Dtok-1"), true);
});

Deno.test("ensureInvitedUser: net-new user → invite link to /reset-password + id", async () => {
  const { deps, calls } = makeFakeDeps({
    generateLinkResult: {
      data: { properties: { action_link: "https://link.example/invite" }, user: { id: "new-1" } },
      error: null,
    },
  });
  const r = await ensureInvitedUser(deps, { email: "new@acme.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "new-1");
  assertEquals(r.actionLink, "https://link.example/invite");
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "invite");
  assertEquals(params.options.redirectTo.includes("/reset-password?redirect="), true);
  assertEquals(params.options.redirectTo.includes("%2Faccept-invite%3Ftoken%3Dtok-1"), true);
});

Deno.test("ensureInvitedUser: a foreign appOrigin is never minted into the redirect", async () => {
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } },
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  await ensureInvitedUser(deps, { email: "known@x.com", appOrigin: "https://evil.example", token: "tok-1" });
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { options: { redirectTo: string } };
  assertEquals(params.options.redirectTo.includes("evil.example"), false); // foreign origin dropped
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect="), true);
});

Deno.test("ensureInvitedUser: generateLink without action_link throws", async () => {
  const { deps } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } },
    generateLinkResult: { data: { properties: {} }, error: null }, // resolved, but no action_link
  });
  let threw = false;
  try {
    await ensureInvitedUser(deps, { email: "known@x.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("sendOrgInvitationEmail: sends org-invitation with the action link", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1", actionLink: "https://link.example/invite",
  });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://link.example/invite");
});
