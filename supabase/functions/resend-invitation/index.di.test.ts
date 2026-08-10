import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  // A resend's deliverable IS the email, so a suppressed address is an honest 422 (see
  // the suppressed-copy test below), the email attempt was made...
  assertEquals(res.status, 422);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
  // ...and no stamp, because nothing was delivered.
  assertEquals(calls.some((c) => c.table === "rpc:mark_invitation_resent"), false);
});

Deno.test("resend-invitation DI: sends the role label, roleKey, expiresOn from the invitation row, and resolves the inviter from invited_by", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" }, "orig-inviter": { email: "orig@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: {
          id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending",
          token: "tok123", expires_at: "2026-08-24T00:00:00Z", invited_by: "orig-inviter",
        },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
      profiles: { data: { display_name: "Original Inviter" }, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  const msg = emails[0].body as {
    templateData: { role: string; roleKey: string; expiresOn: string; inviterName: string };
  };
  assertEquals(msg.templateData.role, "Production Team");
  assertEquals(msg.templateData.roleKey, "producer");
  // The DB is the single source of truth: this states the invitation row's real
  // expires_at, not a value invented or refreshed by this endpoint.
  assertEquals(msg.templateData.expiresOn, "24 August 2026, 02:00 Berlin time");
  assertEquals(msg.templateData.inviterName, "Original Inviter");
});

Deno.test("resend-invitation DI: never writes to the invitation row (expires_at is read-only here)", async () => {
  // Regression: a resend must not push the invitation's expiry out. The row's expires_at
  // is set once at insert time (create-invitation / provision-org) and never touched again
  // by this endpoint — resending only re-sends the email that states whatever it already is.
  // (expires_at is deliberately still in the future here: an already-expired invitation
  // is covered separately below, and that path returns before this one even matters.)
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: {
          id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending",
          token: "tok123", expires_at: "2027-01-01T00:00:00Z",
        },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const update = calls.find((c) => c.table === "org_invitations" && c.method === "update");
  assertEquals(update, undefined, "resend never writes to org_invitations");
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

Deno.test("resend-invitation: 409 for an invitation whose window has already passed, since a resend never pushes expires_at out", async () => {
  // status stays 'pending' forever (nothing flips it to 'expired'; accept_invitation
  // checks expires_at > now() at accept time instead), so the status check above does
  // not catch this. Left unguarded, this would email a concrete PAST date ("works until
  // 1 January 2026...") which is worse than the old generic "expires in 14 days" line.
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: {
        data: {
          id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending",
          expires_at: "2026-01-01T00:00:00Z",
        },
        error: null,
      },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assert(/expired/i.test(body.error), "tells the admin the invitation expired, not a generic failure");
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0, "never sends an email for an already-expired invitation");
});

Deno.test("resend-invitation DI: the idempotency key is stable per invitation, so a duplicate in-flight resend dedupes at Resend rather than double-sending", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: {
          id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending",
          token: "tok123", expires_at: "2027-01-01T00:00:00Z",
        },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const req = () => makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } });
  await handle(req(), deps);
  await handle(req(), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 2);
  const keys = emails.map((c) => (c.body as { idempotency_key?: string }).idempotency_key);
  assertExists(keys[0]);
  assertEquals(keys[0], keys[1], "same invitation resent twice mints the same key, matching create-invitation's per-invitation scheme");
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

// === Spec: an honest response when the email itself never delivered ===
//
// For a resend, the email IS the deliverable (unlike create-invitation, where the
// invitation row is the artifact that exists regardless). Silently returning
// { ok: true } when the send failed strands the caller with no visible outcome, so a
// resend must gate its response on emailWasSent (see _shared/deps.ts).

Deno.test("resend-invitation: tells the admin a suppressed address is permanently undeliverable, not a transient failure worth retrying", async () => {
  // A suppressed address (hard bounce / unsubscribe) stays suppressed until the row
  // leaves suppressed_emails, so retrying "in a moment" can never succeed for it — that
  // generic copy would be false here. This must read differently from a genuine outage.
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
    emailResult: { data: { success: false, reason: "email_suppressed" }, error: null },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 422);
  const body = await res.json();
  assertExists(body.error);
  assert(
    /unsubscrib|bounc/i.test(body.error),
    "names the actual reason (suppressed/bounced/unsubscribed), not a generic failure",
  );
  assertEquals(body.error.includes("Try again in a moment"), false, "does not ask the admin to retry something that can never succeed");
  // The membership reassertion already ran and must not be undone by the email failure.
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv1", p_user: "existing-invitee" }]);
});

Deno.test("resend-invitation: reports failure when sendOrgInvitationEmail throws (e.g. Resend outage)", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  // Simulate a hard delivery failure (e.g. the Resend call itself rejects), same pattern
  // expire-offers's DI tests use.
  (deps as { sendEmail: unknown }).sendEmail = () => { throw new Error("SMTP down"); };

  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 502);
  const body = await res.json();
  assertExists(body.error);
  // The membership reassertion already ran and must not be undone by the email failure.
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv1", p_user: "existing-invitee" }]);
});

Deno.test("resend-invitation: still 200s and delivers when the email genuinely sends", async () => {
  // Regression guard for the two failure tests above: the default fake emailResult is a
  // real send, so the ordinary path must be unaffected by the new emailWasSent gate.
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
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
