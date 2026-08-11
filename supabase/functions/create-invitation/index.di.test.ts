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
 *    with a durable token URL and no short-lived Auth action link in the payload.
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
  const msg = emails[0].body as { template_name: string; recipient_email: string; templateData: { token: string; orgName: string; inviterEmail: string; role: string } };
  assertEquals(msg.template_name, "org-invitation");
  assertEquals(msg.recipient_email, "invitee@x.com");
  assertEquals(msg.templateData.token, "tok123");
  assertEquals(msg.templateData.orgName, "Acme");
  assertEquals(msg.templateData.inviterEmail, "admin@acme.test");
  // The email renders the friendly role label, not the raw enum ('producer').
  assertEquals(msg.templateData.role, "Production Team");
});

Deno.test("create-invitation DI: sends roleKey, expiresOn (from the invitation row), and inviterName (from profiles.display_name)", async () => {
  const { deps, invokeCalls, calls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123", expires_at: "2026-08-24T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
      profiles: { data: { display_name: "Jane Admin" }, error: null },
    },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  const msg = emails[0].body as {
    templateData: { role: string; roleKey: string; expiresOn: string; inviterName: string };
  };
  assertEquals(msg.templateData.role, "Production Team");
  // The raw enum, not the label: the template uses it to select which second-person
  // role action line to render (see org-invitation.tsx's roleActionLine).
  assertEquals(msg.templateData.roleKey, "producer");
  // The exact calendar day of the row's expires_at (formatExpiresOn, no arithmetic);
  // the expiryLine's remedy sentence owns the edges a date cannot.
  assertEquals(msg.templateData.expiresOn, "August 24, 2026");
  assertEquals(msg.templateData.inviterName, "Jane Admin");
});

Deno.test("create-invitation DI: no profiles.display_name for the inviter → inviterName is unset, inviterEmail carries it for the template's own fallback", async () => {
  // resolveInviterName no longer pre-fills name with email (that would make the template's
  // own `inviterName || inviterEmail` fallback dead code); the edge function must forward
  // both fields as-is and let the template render the email as the "Invited by" line.
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123", expires_at: "2026-08-24T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
      profiles: { data: null, error: null },
    },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = emails[0].body as { templateData: { inviterName?: string; inviterEmail?: string } };
  assertEquals(msg.templateData.inviterName, undefined);
  assertEquals(msg.templateData.inviterEmail, "admin@acme.test");
});

Deno.test("create-invitation DI: still sends the invitation email when resolving the inviter's display name fails (best-effort, not the deliverable)", async () => {
  // resolveInviterName does an unrelated profiles read plus an Admin API getUserById
  // call. Without a catch, its rejection would hit this caller's outer try/catch (whose
  // catch clause only logs) and skip sendOrgInvitationEmail entirely — turning an
  // unrelated lookup failure into a silently un-sent invite for a brand-new invitee with
  // no other way in. It must degrade to omitting the "Invited by" line instead.
  const { deps, invokeCalls } = adminDeps();
  (deps.admin.auth.admin as { getUserById: unknown }).getUserById = () => Promise.reject(new Error("directory down"));
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1, "the invitation email is still sent despite the inviter-name lookup failing");
  const msg = emails[0].body as { templateData: { inviterName?: string; inviterEmail?: string } };
  assertEquals(msg.templateData.inviterName, undefined);
  assertEquals(msg.templateData.inviterEmail, undefined);
});

Deno.test("create-invitation DI: admin → creates membership at invite time via RPC (net-new invitee)", async () => {
  const { deps, calls } = adminDeps({
    // Net-new invitee → resolved through generateLink (which returns the new user id).
    // No authUsersByEmail, so the duplicate-member 409 guard is skipped.
    generateLinkResult: {
      data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-invitee" } },
      error: null,
    },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertExists(rpcCall);
  assertEquals(rpcCall!.args, [{ p_invitation: "inv1", p_user: "new-invitee" }]);
});

Deno.test("create-invitation DI: net-new invitee → stable-token email without action-link metadata", async () => {
  const { deps, invokeCalls } = adminDeps({
    usersById: {}, // invitee is net-new (no existing auth user)
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  const data = (emails[0].body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(data.token, "tok123");
  assertEquals("actionLink" in data, false);
  assertEquals("isNewUser" in data, false);
});

Deno.test("create-invitation DI: existing invitee does not mint an Auth action link", async () => {
  // The invitee already has an auth account but is NOT yet a member of this org (an
  // array-matched org_memberships seed keeps the admin caller's own membership check
  // separate from the invitee's, which must resolve to "not a member" so the request
  // proceeds past the duplicate-member guard).
  const { deps, invokeCalls, calls } = adminDeps({
    tables: {
      org_memberships: [
        { when: { user_id: "u1" }, data: { role: "admin" } },
        { when: { user_id: "existing-invitee" }, data: null },
      ],
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    generateLinkResult: { data: { properties: { action_link: "https://app.test/auth/callback?redirect=y" } }, error: null },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals("actionLink" in (emails[0].body as { templateData: Record<string, unknown> }).templateData, false);
  assertEquals(calls.some((c) => c.table === "auth.admin.generateLink"), false);
});

Deno.test("create-invitation DI: existing invitee still gets the durable email when generateLink would fail", async () => {
  // ensureInvitedUser can throw AFTER existingUserId was already resolved (generateLink
  // failure), so actionLink stays undefined for this send. org-invitation.tsx's ctaHint
  // checks `!actionLink` before it ever looks at isNewUser (see the doc comment on the
  // catch block in index.ts), so what actually matters here is that no actionLink went
  // out at all, not what isNewUser happens to be. The render-level proof that a missing
  // actionLink always wins, regardless of isNewUser, lives in org-invitation.test.ts
  // ("falls back to an honest sign-in hint even when isNewUser was never resolved and
  // there is no action link").
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: [
        { when: { user_id: "u1" }, data: { role: "admin" } },
        { when: { user_id: "existing-invitee" }, data: null },
      ],
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    generateLinkResult: { data: null, error: { message: "mail service unavailable" } },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1, "still delivers via the fallback bare-token link, rather than silently dropping the email");
  const msg = emails[0].body as { templateData: Record<string, unknown> };
  assertEquals(msg.templateData.token, "tok123");
});

Deno.test("create-invitation DI: net-new account minting fails → no dead-link email, still 200", async () => {
  // A net-new invitee whose account cannot be minted (generateLink errors) has neither an
  // existing account nor an actionLink, so a plain-link email would be a dead end. The
  // invitation row still exists (request succeeds), but no unusable email is sent.
  const { deps, invokeCalls } = adminDeps({
    usersById: {}, // net-new (no existing auth user)
    generateLinkResult: { data: null, error: { message: "could not create user" } },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

// === Spec A: optional artist_id (deterministic link from the artist surface) ===

Deno.test("create-invitation DI: valid artist_id → stamps artist_id + forces role artist", async () => {
  const { deps, calls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      artists: { data: { id: "art-1", org_id: "org-1", user_id: null }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z", artist_id: "art-1" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  // role 'producer' in the body must be overridden to 'artist' when artist_id is present.
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer", artist_id: "art-1" }), deps);
  assertEquals(res.status, 200);
  const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
  assertExists(insert);
  assertEquals(insert.args[0], { org_id: "org-1", email: "invitee@x.com", role: "artist", invited_by: "u1", artist_id: "art-1" });
});

Deno.test("create-invitation DI: artist_id from another org → 400", async () => {
  const { deps } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      artists: { data: { id: "art-1", org_id: "other-org", user_id: null }, error: null },
    },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist", artist_id: "art-1" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: artist_id already registered → 400", async () => {
  const { deps } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      artists: { data: { id: "art-1", org_id: "org-1", user_id: "u9" }, error: null },
    },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist", artist_id: "art-1" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("create-invitation DI: no artist_id → legacy insert has no artist_id key", async () => {
  const { deps, calls } = adminDeps();
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
  assertExists(insert);
  assertEquals(Object.prototype.hasOwnProperty.call(insert.args[0] as object, "artist_id"), false);
});

// === Spec: producer_can_invite capability (Task 5) ===
//
// Admins/super-admins are unchanged (may invite any role). A caller who is only a
// producer may invite ONLY role='artist', and ONLY when the org's producer_can_invite
// capability is on.

function producerDeps(extra: Record<string, unknown> = {}) {
  return makeFakeDeps({
    authUser: { id: "p1" },
    usersById: { p1: { email: "prod@acme.test" } },
    tables: {
      org_memberships: { data: { role: "producer" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    ...extra,
  });
}

Deno.test("create-invitation DI: producer invites artist with capability ON → 200", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: true, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  assertEquals(res.status, 200);
});

Deno.test("create-invitation DI: producer invites artist with capability OFF → 403 capability_disabled", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: false, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "capability_disabled");
});

Deno.test("create-invitation DI: producer invites a PRODUCER (cap on) → 403 producers_can_only_invite_artists", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: true, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "producers_can_only_invite_artists");
});

Deno.test("create-invitation DI: admin still invites a producer → 200 (unchanged)", async () => {
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
});

// === Server-side duplicate guard ===

Deno.test("create-invitation DI: email already belongs to an org member → 409", async () => {
  // get_user_id_by_email resolves the invitee to u2; the org_memberships seed (which
  // also authorizes the admin caller) means u2 is a member of the org → reject. With
  // no PENDING invite (org_invitations → null), this is a genuine member, so the
  // member 409 wins over the pending-invitation branch.
  const { deps, calls } = adminDeps({
    authUsersByEmail: { "invitee@x.com": { id: "u2" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: null, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 409);
  const body = await res.json() as { error: string };
  assertEquals(/already belongs to a member/i.test(body.error), true);
  // Rejected before any insert.
  assertEquals(calls.some((c) => c.table === "org_invitations" && c.method === "insert"), false);
});

Deno.test("create-invitation DI: re-inviting a still-PENDING invitee → 409 pending (not member)", async () => {
  // Membership is now created at invite time (migration 20260809170001), so a
  // still-pending invitee already has an org_memberships row and would trip the
  // member check. When a live pending invite exists we must return the accurate
  // "already has a pending invitation" message, NOT the generic member 409.
  const { deps, calls } = adminDeps({
    authUsersByEmail: { "invitee@x.com": { id: "u2" } }, // invite-time auth account
    tables: {
      org_memberships: { data: { role: "admin" }, error: null }, // authorizes admin + invite-time membership row
      org_invitations: { data: { id: "inv-pending", org_id: "org-1", email: "invitee@x.com", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 409);
  const body = await res.json() as { error: string };
  assertEquals(/already has a pending invitation/i.test(body.error), true);
  // Rejected before any insert.
  assertEquals(calls.some((c) => c.table === "org_invitations" && c.method === "insert"), false);
});

Deno.test("create-invitation DI: existing pending invite (unique violation) → 409", async () => {
  // Invitee is net-new (no authUsersByEmail), so the member check is skipped; the
  // partial unique index rejects the insert with 23505, mapped to a friendly 409.
  const { deps } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 409);
  const body = await res.json() as { error: string };
  assertEquals(/already has a pending invitation/i.test(body.error), true);
});

Deno.test("create-invitation DI: non-member fresh email still invites → 200 (member check is skip-safe)", async () => {
  // authUsersByEmail unseeded → get_user_id_by_email returns null → membership lookup
  // skipped → normal insert path, proving the guard doesn't block net-new invitees.
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "fresh@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
});

// offersExpected (see resolveArtistOffersExpected, _shared/invitations.ts) requires
// entitled + active + artist_acceptance all to check out, not artist_acceptance alone:
// see the two regression tests below (unentitled, and the paused "off" preset) for the
// exact gap this closes.

Deno.test("create-invitation DI: an artist invite resolves offersExpected from the org's own booking_flow setting", async () => {
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
      // resolveOrgSetting reads app_settings via a `key`-matched array seed (mirrors the
      // pattern used across the other booking-flow DI tests, e.g. provision-org's).
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", key: "booking_flow", value: { artist_acceptance: false } }], error: null },
      ],
    },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  const msg = emails[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("create-invitation DI: an artist invite defaults offersExpected to true when the org has no booking_flow override (entitled by default in this fake)", async () => {
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = emails[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, true);
});

Deno.test("create-invitation DI: an artist invite in an UNENTITLED org resolves offersExpected to false, never resolveBookingFlow's fail-open defaults", async () => {
  // Regression: resolveBookingFlow ALONE would return BOOKING_FLOW_DEFAULTS here
  // (artist_acceptance: true) since it fails open to the defaults on an unentitled org.
  // The invitation email must not promise offers this org's module can never send.
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = emails[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("create-invitation DI: an artist invite in a freshly provisioned but still-PAUSED org (booking_flow.active: false) resolves offersExpected to false", async () => {
  // Regression: this is the exact seed provision-org writes for every freshly
  // provisioned org with booking enabled (normalizeBookingFlow({active:false})).
  // artist_acceptance is unset in that stored row, so it defaults true; without also
  // checking flow.active this would incorrectly read as "offers coming" for an org that
  // has not even turned booking on yet.
  const { deps, invokeCalls } = adminDeps({
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", key: "booking_flow", value: { active: false } }], error: null },
      ],
    },
  });
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = emails[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("create-invitation DI: a non-artist invite never resolves offersExpected (irrelevant to that role)", async () => {
  const { deps, invokeCalls } = adminDeps();
  await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = emails[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, undefined);
});
