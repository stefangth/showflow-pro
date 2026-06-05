/**
 * Deep DI tests for create-invitation.
 *
 * Contract:
 *  - OPTIONS → preflight
 *  - no Bearer → 401
 *  - invalid payload (missing org_id/email/role/app_origin) → 400; invalid email/role → 400
 *  - caller not an admin of the target org → 403
 *  - admin → 200 { ok, invitation }; inserts org_invitations with the (lowercased)
 *    email + invited_by = caller; delivers the 'org-invitation' email to the invitee
 *    (net-new invitees get an actionLink via the unified deliverOrgInvitation helper).
 *
 * requireOrgRole reads org_memberships (eq user_id, eq org_id, in role, maybeSingle);
 * the fake's maybeSingle applies the .in("role",[...]) filter, so a single seed row
 * with role 'admin' authorizes the caller.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const APP_ORIGIN = "https://app.test";

function adminDeps(extra: Record<string, unknown> = {}) {
  return makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    ...extra,
  });
}

/** A request whose body always carries app_origin (per-test fields override / extend it). */
function inviteReq(body: Record<string, unknown>) {
  return makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { app_origin: APP_ORIGIN, ...body } });
}

Deno.test("create-invitation DI: OPTIONS → preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("create-invitation DI: no Bearer token → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: { org_id: "org-1", email: "x@y.com", role: "producer", app_origin: APP_ORIGIN } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("create-invitation DI: missing email → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", role: "producer" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: missing app_origin → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { org_id: "org-1", email: "x@y.com", role: "producer" } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: invalid role → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "x@y.com", role: "superuser" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: malformed email → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "not-an-email", role: "producer" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: caller is not an admin of the org → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u2" },
    tables: { org_memberships: { data: { role: "producer" }, error: null } }, // producer, not admin
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "x@y.com", role: "artist" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("create-invitation DI: admin → 200 with invitation, inserts row + invited_by", async () => {
  const { deps, calls } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; invitation: { token: string; email: string } };
  assertEquals(body.ok, true);
  assertEquals(body.invitation.token, "tok123");

  const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
  assertExists(insert);
  assertEquals(insert.args[0], { org_id: "org-1", email: "invitee@x.com", role: "producer", invited_by: "u1" });
});

Deno.test("create-invitation DI: email is lowercased + trimmed before insert", async () => {
  const { deps, calls } = adminDeps();
  await handle(inviteReq({ org_id: "org-1", email: "  Invitee@X.COM  ", role: "producer" }), deps);
  const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
  assertExists(insert);
  assertEquals((insert.args[0] as { email: string }).email, "invitee@x.com");
});

Deno.test("create-invitation DI: sends the org-invitation email to the invitee with the token", async () => {
  const { deps, invokeCalls } = adminDeps();
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  const msg = emails[0].body as { template_name: string; recipient_email: string; templateData: { token: string; orgName: string; inviterEmail: string } };
  assertEquals(msg.template_name, "org-invitation");
  assertEquals(msg.recipient_email, "invitee@x.com");
  assertEquals(msg.templateData.token, "tok123");
  assertEquals(msg.templateData.orgName, "Acme");
  assertEquals(msg.templateData.inviterEmail, "admin@acme.test");
});

Deno.test("create-invitation DI: net-new invitee → branded email WITH actionLink", async () => {
  const { deps, invokeCalls } = adminDeps({
    usersById: {}, // invitee is net-new (no existing auth user)
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});
