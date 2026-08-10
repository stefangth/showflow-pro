import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

Deno.test("resend-invitation: super-admin re-sends the invite email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("resend-invitation DI: resends email + reasserts membership via RPC", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null }, mark_invitation_resent: { data: null, error: null } },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv1", p_user: "existing-invitee" }]);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
  // Stamps the resend so other admins can see when/how often it was resent.
  const stamp = calls.find((c) => c.table === "rpc:mark_invitation_resent");
  assertEquals(stamp?.args, [{ p_id: "inv1" }]);
});

Deno.test("resend-invitation: suppressed/skipped send does NOT stamp the resend counter", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org-1", email: "bounced@x.com", role: "producer", status: "pending", token: "tok123" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "bounced@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null }, mark_invitation_resent: { data: null, error: null } },
    // send-transactional-email returns 200 { success: false } for a suppressed address —
    // a skip, not a delivery. The resend counter must NOT advance in that case.
    emailResult: { data: { success: false, reason: "email_suppressed" }, error: null },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  // The request still succeeds (best-effort resend), the email attempt was made...
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
  // ...but no stamp, because nothing was delivered.
  assertEquals(calls.some((c) => c.table === "rpc:mark_invitation_resent"), false);
});

Deno.test("resend-invitation: opaque 403 for unknown invitation (no existence leak)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: null, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "nope", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 403);
});

Deno.test("resend-invitation: 409 for a non-pending invitation", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "accepted" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 409);
});

Deno.test("resend-invitation: net-new pending invite → branded email with actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      org_invitations: { data: { id: "inv-1", org_id: "org-1", email: "new@acme.com", role: "artist", token: "tok-1", status: "pending" }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv-1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});

// === Spec: producer_can_view_linked_accounts capability ===
//
// Admins/super-admins bypass the capability gate outright (requireOrgRole's admin
// check passes first). A caller who is only a producer of the invitation's org must
// additionally hold the producer_can_view_linked_accounts capability.

Deno.test("resend-invitation: producer with producer_can_view_linked_accounts ON → 200", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "p1" },
    tables: {
      org_memberships: { data: { role: "producer" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    rpcs: { is_capability_enabled: { data: true, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("resend-invitation: producer with producer_can_view_linked_accounts OFF → 403 capability_disabled", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "p1" },
    tables: {
      org_memberships: { data: { role: "producer" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    rpcs: { is_capability_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "capability_disabled");
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("resend-invitation: admin bypasses the capability gate entirely (never calls is_capability_enabled)", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      org_invitations: { data: { id: "inv-1", org_id: "org-1", email: "new@acme.com", role: "artist", token: "tok-1", status: "pending" }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    // is_capability_enabled intentionally NOT seeded — the fake defaults it to
    // { data: null, error: null }, which checkCapability treats as OFF. An admin
    // caller must never reach that check at all.
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv-1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "rpc:is_capability_enabled"), false);
});
