import { assertEquals } from "./test-asserts.ts";
import { ensureInvitedUser, sendOrgInvitationEmail } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const APP_ORIGIN = "https://app.test";

Deno.test("ensureInvitedUser: existing user → resolves id, no action link", async () => {
  const { deps } = makeFakeDeps({
    authUsersByEmail: { "old@acme.com": { id: "u9" } },
  });
  const r = await ensureInvitedUser(deps, { email: "old@acme.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "u9");
  assertEquals(r.actionLink, undefined);
});

Deno.test("ensureInvitedUser: net-new user → generateLink returns id + action link", async () => {
  const { deps } = makeFakeDeps({
    generateLinkResult: {
      data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-1" } },
      error: null,
    },
  });
  const r = await ensureInvitedUser(deps, { email: "new@acme.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "new-1");
  assertEquals(r.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("sendOrgInvitationEmail: sends org-invitation with the action link", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1", actionLink: "https://app.test/reset-password?redirect=x",
  });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://app.test/reset-password?redirect=x");
});
