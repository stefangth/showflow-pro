import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverOrgInvitation } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const base = {
  orgName: "Acme",
  role: "artist",
  token: "tok-1",
  inviterEmail: "boss@acme.com",
  appOrigin: "https://app.test",
  idempotencyKey: "org-invitation-1",
  orgId: "org-1",
};

Deno.test("deliverOrgInvitation: net-new user → generateLink action link embedded in branded email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: {}, // no existing user with this email → net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1" } }, error: null },
  });
  await deliverOrgInvitation(deps, { ...base, email: "new@acme.com" });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1");
});

Deno.test("deliverOrgInvitation: existing user → branded email with NO actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { u9: { email: "old@acme.com" } }, // existing
  });
  await deliverOrgInvitation(deps, { ...base, email: "old@acme.com" });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { templateData: { actionLink?: string } };
  assertEquals(body.templateData.actionLink, undefined);
});
