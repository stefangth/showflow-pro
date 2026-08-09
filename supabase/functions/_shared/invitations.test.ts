import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverOrgInvitation } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const base = {
  orgName: "Acme",
  role: "artist",
  token: "tok-1",
  inviterEmail: "boss@acme.com",
  appOrigin: "http://localhost:8080", // allowlisted by safeAppOrigin so it flows through unchanged
  idempotencyKey: "org-invitation-1",
  orgId: "org-1",
};

Deno.test("deliverOrgInvitation: net-new user → invite link to /reset-password embedded in branded email", async () => {
  const { deps, invokeCalls, calls } = makeFakeDeps({
    usersById: {}, // no existing user with this email → net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1" } }, error: null },
  });
  await deliverOrgInvitation(deps, { ...base, email: "new@acme.com" });

  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1");

  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "invite");
  assertEquals(params.options.redirectTo.includes("/reset-password?redirect="), true);
  assertEquals(params.options.redirectTo.includes("%2Faccept-invite%3Ftoken%3Dtok-1"), true);
});

Deno.test("deliverOrgInvitation: existing user -> magic link actionLink to /auth/callback", async () => {
  const { deps, invokeCalls, calls } = makeFakeDeps({
    usersById: { "uid-1": { email: "known@x.com" } }, // makes userExistsByEmail true
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  await deliverOrgInvitation(deps, { ...base, email: "known@x.com" });

  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { templateData: { actionLink?: string } };
  assertEquals(body.templateData.actionLink, "https://link.example/magic"); // non-empty now

  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect="), true);
  assertEquals(params.options.redirectTo.includes("%2Faccept-invite%3Ftoken%3Dtok-1"), true);
});

Deno.test("deliverOrgInvitation: a foreign appOrigin is never minted into the redirect", async () => {
  const { deps, calls } = makeFakeDeps({
    usersById: { "uid-1": { email: "known@x.com" } }, // existing-user magic-link branch
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  await deliverOrgInvitation(deps, { ...base, email: "known@x.com", appOrigin: "https://evil.example" });
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { options: { redirectTo: string } };
  assertEquals(params.options.redirectTo.includes("evil.example"), false); // foreign origin dropped
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect="), true);
});

Deno.test("deliverOrgInvitation: generateLink without action_link throws and sends no email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { "uid-1": { email: "known@x.com" } }, // existing-user branch
    generateLinkResult: { data: { properties: {} }, error: null }, // resolved, but no action_link
  });
  await assertRejects(() => deliverOrgInvitation(deps, { ...base, email: "known@x.com" }));
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});
