import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { FEATURE_KEYS } from "../_shared/entitlements.ts";

const body = { name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" };

Deno.test("provision-org: 403 for non-super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 403);
});

Deno.test("provision-org: net-new admin → RPC + stable-token email, returns org_id", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {}, // net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).org_id, "org-9");
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const data = (sent[0].body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(data.token, "tok-9");
  assertEquals("actionLink" in data, false);
  assertEquals("isNewUser" in data, false);
});

Deno.test("provision-org: existing admin → stable-token email without minting a magic link", async () => {
  // Invite hardening: an existing auth user now gets a one-click magic link (type:'magiclink'
  // to /auth/callback) instead of an empty actionLink that forced the unbranded reset flow.
  const { deps, invokeCalls, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    authUsersByEmail: { "a@acme.com": { id: "u2" } }, // existing (resolved via get_user_id_by_email)
    generateLinkResult: { data: { properties: { action_link: "https://app.test/auth/callback?redirect=y" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const data = (sent[0].body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(data.token, "tok-9");
  assertEquals("actionLink" in data, false);
  assertEquals(calls.some((c) => c.table === "auth.admin.generateLink"), false);
});

Deno.test("provision-org: sends the role label, roleKey, and expiresOn derived from the invitation row", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv-9", expires_at: "2026-08-24T00:00:00Z" }, error: null },
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const msg = sent[0].body as { templateData: { role: string; roleKey: string; expiresOn: string } };
  assertEquals(msg.templateData.role, "Admin");
  assertEquals(msg.templateData.roleKey, "admin");
  // The exact calendar day of the row's expires_at (formatExpiresOn, no arithmetic);
  // the expiryLine's remedy sentence owns the edges a date cannot.
  assertEquals(msg.templateData.expiresOn, "August 24, 2026");
});

Deno.test("provision-org: always uses the generic ShowFlow team inviter line, even when the operator has a display name on file, and never resolves or forwards their personal name or email", async () => {
  // The first admin of a brand-new org is a total stranger to the super-admin
  // provisioning it, so "Invited by" always reads a generic, org-neutral line here,
  // regardless of whether the operator happens to have a profiles.display_name on file:
  // a stranger has no more context for "Jordan Owner" than for owner@platform.test (see
  // the doc comment in provision-org/index.ts for why this is DIFFERENT from
  // create-invitation/resend-invitation, which do resolve and forward a real name).
  // Since there is nothing to resolve, there is also no profiles read and no failure
  // mode to guard against.
  const { deps, invokeCalls, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "owner@platform.test" } },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      profiles: { data: { display_name: "Jordan Owner" }, error: null },
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const msg = sent[0].body as { templateData: { inviterName?: string; inviterEmail?: string } };
  assertEquals(msg.templateData.inviterName, "the ShowFlow team");
  assertEquals(msg.templateData.inviterEmail, undefined);
  // resolveInviterName's profiles read never happens: there is nothing to resolve, and
  // the seeded display_name above is never touched.
  assertEquals(calls.some((c) => c.table === "profiles"), false, "never reads profiles: this line is never personalized for this caller");
});

Deno.test("provision-org: net-new first admin → template payload omits account-state metadata", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {}, // net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const data = (sent[0].body as { templateData: Record<string, unknown> }).templateData;
  assertEquals("isNewUser" in data, false);
  assertEquals("actionLink" in data, false);
});

Deno.test("provision-org: creates first-admin membership at invite time via RPC", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv-9" }, error: null }, // token lookup returns the invitation id
    },
    rpcs: {
      provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null },
      ensure_invitation_membership: { data: true, error: null },
    },
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-admin" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv-9", p_user: "new-admin" }]);
});

Deno.test("provision-org: 409 on duplicate slug", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: null, error: { code: "23505", message: "duplicate key" } } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 409);
});

// ---------------------------------------------------------------------------
// Task 9: seed org_entitlements from the platform default_entitlements setting
// at creation time. resolveOrgSetting reads app_settings via a `key`-matched
// array seed (mirrors the pattern used across the other booking-flow DI tests).
// ---------------------------------------------------------------------------

Deno.test("provision-org: seeds org_entitlements from the resolved default_entitlements setting", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      app_settings: [
        {
          when: { key: "default_entitlements" },
          data: [{ org_id: null, value: { booking_flow: true, hire_orders: true } }],
          error: null,
        },
      ],
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);

  const insertCall = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  assertEquals(insertCall !== undefined, true);
  const rows = insertCall!.args[0] as Array<{ org_id: string; feature: string; enabled: boolean }>;
  assertEquals(rows.length, FEATURE_KEYS.length);
  assertEquals(rows.every((r) => r.org_id === "org-9"), true);
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, true);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, true);
});

Deno.test("provision-org: falls back to registry defaults when default_entitlements is unset", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } }, // no app_settings row
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);

  const insertCall = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  assertEquals(insertCall !== undefined, true);
  const rows = insertCall!.args[0] as Array<{ org_id: string; feature: string; enabled: boolean }>;
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, true);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, false);
});

// ---------------------------------------------------------------------------
// Task 5: explicit `entitlements` request body seeds those exact rows
// (validated against FEATURE_KEYS, falls back to default_entitlements /
// registry defaults for any key it omits), and enabling booking_flow at
// creation time also seeds an inactive (off) booking_flow app_settings row.
// ---------------------------------------------------------------------------

Deno.test("provision-org: explicit entitlements body seeds those exact rows", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer x" },
      body: { ...body, entitlements: { booking_flow: false, hire_orders: true } },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insertCall = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  assertEquals(insertCall !== undefined, true);
  const rows = insertCall!.args[0] as Array<{ org_id: string; feature: string; enabled: boolean }>;
  assertEquals(rows.length, FEATURE_KEYS.length);
  assertEquals(rows.every((r) => r.org_id === "org-9"), true);
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, false);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, true);
});

Deno.test("provision-org: enabling booking_flow seeds an inactive (off) flow policy", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer x" },
      body: { ...body, entitlements: { booking_flow: true } },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const upsertCall = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
  assertEquals(upsertCall !== undefined, true);
  const rows = upsertCall!.args[0] as { org_id: string; key: string; value: unknown }[];
  const row = rows.find((candidate) => candidate.key === "booking_flow")! as { org_id: string; key: string; value: { active: boolean } };
  assertEquals(row.org_id, "org-9");
  assertEquals(row.key, "booking_flow");
  assertEquals(row.value.active, false);
  assertEquals(rows.find((candidate) => candidate.key === "booking_flow_template")?.value, "off");
});

Deno.test("provision-org: leaving booking_flow disabled still seeds the off template snapshot", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer x" },
      body: { ...body, entitlements: { booking_flow: false } },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const upsertCall = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
  const rows = upsertCall!.args[0] as { key: string; value: unknown }[];
  assertEquals(rows.find((candidate) => candidate.key === "booking_flow_template")?.value, "off");
});

// ---------------------------------------------------------------------------
// The New Organization picker can provision a first "admin" account with any
// role (a producer- or artist-first org is a legitimate, if rare, choice), so
// offersExpected branching (resolveArtistOffersExpected, _shared/invitations.ts)
// applies here too whenever role is "artist". Requires entitled + active +
// artist_acceptance all to check out, not artist_acceptance alone: see the
// unentitled and paused-preset regressions below for the exact gap this closes.
// ---------------------------------------------------------------------------

Deno.test("provision-org: role artist resolves offersExpected from the org's own booking_flow setting", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-9", key: "booking_flow", value: { artist_acceptance: false } }], error: null },
      ],
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, role: "artist" } }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const msg = sent[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("provision-org: role artist in an UNENTITLED org resolves offersExpected to false, never resolveBookingFlow's fail-open defaults", async () => {
  // Regression: resolveBookingFlow ALONE would return BOOKING_FLOW_DEFAULTS here
  // (artist_acceptance: true) since it fails open to the defaults on an unentitled org.
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: {
      provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null },
      is_feature_enabled: { data: false, error: null },
    },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, role: "artist" } }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = sent[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("provision-org: role artist in a freshly provisioned org still in the PAUSED preset (booking_flow.active: false) resolves offersExpected to false", async () => {
  // Regression: this is the exact seed provision-org's own entitlement-seeding step
  // writes for every freshly provisioned org with booking enabled
  // (normalizeBookingFlow({active:false})). artist_acceptance is unset in that stored
  // row (defaults true), so without also checking flow.active this would incorrectly
  // read as "offers coming" for an org that has not even turned booking on yet.
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-9", key: "booking_flow", value: { active: false } }], error: null },
      ],
    },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, role: "artist" } }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = sent[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, false);
});

Deno.test("provision-org: role admin (the common case) never resolves offersExpected", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = sent[0].body as { templateData: { offersExpected?: boolean } };
  assertEquals(msg.templateData.offersExpected, undefined);
});
