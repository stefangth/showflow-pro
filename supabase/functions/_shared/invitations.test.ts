import { assertEquals } from "./test-asserts.ts";
import {
  ensureInvitedAccount,
  formatExpiresOn,
  ORG_INVITATION_EXPIRY_DAYS,
  mintInvitationActionLink,
  resendIdempotencyKey,
  resolveArtistOffersExpected,
  resolveInviterName,
  sendOrgInvitationEmail,
  SYSTEM_INVITER_NAME,
} from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";
import { EMAIL_COPY_DEFAULTS } from "./transactional-email-templates/_shell/emailCopy.ts";

const APP_ORIGIN = "http://localhost:8080"; // allowlisted by safeAppOrigin so it flows through unchanged

Deno.test("ensureInvitedAccount: existing user returns its id without generating a link", async () => {
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } }, // existing (resolved via get_user_id_by_email)
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  const r = await ensureInvitedAccount(deps, { email: "known@x.com", appOrigin: APP_ORIGIN });
  assertEquals(r, { userId: "u9", isNewUser: false });
  assertEquals(calls.some((c) => c.table === "auth.admin.generateLink"), false);
});

Deno.test("ensureInvitedAccount: a pre-resolved existing user skips the duplicate lookup", async () => {
  const { deps, calls } = makeFakeDeps();
  const r = await ensureInvitedAccount(deps, {
    email: "known@x.com",
    appOrigin: APP_ORIGIN,
    existingUserId: "u9",
  });
  assertEquals(r, { userId: "u9", isNewUser: false });
  assertEquals(calls.some((c) => c.table === "rpc:get_user_id_by_email"), false);
  assertEquals(calls.some((c) => c.table === "auth.admin.generateLink"), false);
});

Deno.test("ensureInvitedAccount: a pre-resolved missing user skips lookup and creates the account", async () => {
  const { deps, calls } = makeFakeDeps({
    generateLinkResult: { data: { user: { id: "new-1" } }, error: null },
  });
  const r = await ensureInvitedAccount(deps, {
    email: "new@x.com",
    appOrigin: APP_ORIGIN,
    existingUserId: null,
  });
  assertEquals(r, { userId: "new-1", isNewUser: true });
  assertEquals(calls.some((c) => c.table === "rpc:get_user_id_by_email"), false);
});

Deno.test("ensureInvitedAccount: net-new user is created with an invite link that is discarded", async () => {
  const { deps, calls } = makeFakeDeps({
    generateLinkResult: {
      data: { properties: { action_link: "https://link.example/invite" }, user: { id: "new-1" } },
      error: null,
    },
  });
  const r = await ensureInvitedAccount(deps, { email: "new@acme.com", appOrigin: APP_ORIGIN });
  assertEquals(r, { userId: "new-1", isNewUser: true });
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "invite");
  assertEquals(params.options.redirectTo, `${APP_ORIGIN}/auth/callback?redirect=%2Faccept-invite`);
});

Deno.test("mintInvitationActionLink: existing user receives a magic link", async () => {
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } },
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  const link = await mintInvitationActionLink(deps, { email: "known@x.com", appOrigin: APP_ORIGIN });
  assertEquals(link, "https://link.example/magic");
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo, `${APP_ORIGIN}/auth/callback?redirect=%2Faccept-invite`);
  assertEquals(params.options.redirectTo.includes("token="), false);
});

Deno.test("mintInvitationActionLink: missing user receives an invite link", async () => {
  const { deps, calls } = makeFakeDeps({
    generateLinkResult: { data: { properties: { action_link: "https://link.example/invite" }, user: { id: "new-1" } }, error: null },
  });
  assertEquals(await mintInvitationActionLink(deps, { email: "new@x.com", appOrigin: APP_ORIGIN }), "https://link.example/invite");
  const gen = calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "invite");
  assertEquals(params.options.redirectTo, `${APP_ORIGIN}/auth/callback?redirect=%2Faccept-invite`);
});

Deno.test("mintInvitationActionLink: a foreign appOrigin falls back to the allowlisted app URL", async () => {
  const { deps, calls } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } },
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  await mintInvitationActionLink(deps, { email: "known@x.com", appOrigin: "https://evil.example" });
  const params = calls.find((c) => c.table === "auth.admin.generateLink")!.args[0] as { options: { redirectTo: string } };
  assertEquals(params.options.redirectTo.includes("evil.example"), false);
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect=%2Faccept-invite"), true);
});

Deno.test("mintInvitationActionLink: generateLink without action_link throws", async () => {
  const { deps } = makeFakeDeps({
    authUsersByEmail: { "known@x.com": { id: "u9" } },
    generateLinkResult: { data: { properties: {} }, error: null }, // resolved, but no action_link
  });
  let threw = false;
  try {
    await mintInvitationActionLink(deps, { email: "known@x.com", appOrigin: APP_ORIGIN });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("sendOrgInvitationEmail: sends the stable token without action-link account metadata", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1",
  });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: Record<string, unknown> };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.token, "tok-1");
  assertEquals("actionLink" in body.templateData, false);
  assertEquals("isNewUser" in body.templateData, false);
});

Deno.test("sendOrgInvitationEmail: returns the raw send result so a caller can gate a side effect on emailWasSent", async () => {
  // Regression: a caller (resend-invitation) reports the resend as FAILED to its own
  // caller when the send didn't truly deliver, rather than returning ok:true
  // unconditionally. That is only possible if this function surfaces the result instead
  // of swallowing it into a bare Promise<void>.
  const { deps } = makeFakeDeps({ emailResult: { data: { success: false, reason: "email_suppressed" }, error: null } });
  const result = await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1",
  });
  assertEquals(result.error, null);
  assertEquals((result.data as { success?: unknown } | null)?.success, false);
});

Deno.test("formatExpiresOn: renders a long-form, date-only string with no time and no timezone name", () => {
  // Date-only and tenant-neutral on purpose: an org-invitation goes to a stranger who has
  // no reason to know or care what timezone the booking engine runs on, unlike the digest
  // emails which genuinely are Berlin-scheduled and say so. This is the EXACT calendar
  // day, not the guaranteed-valid one the email body actually renders; see
  assertEquals(formatExpiresOn("2026-08-24T07:00:00.000Z"), "August 24, 2026");
});

Deno.test("formatExpiresOn: formats in UTC, so the calendar day is deterministic regardless of server locale", () => {
  // 2026-08-24T22:30:00Z is still 2026-08-24 in UTC (it would already be 2026-08-25 in
  // Europe/Berlin); pins the function to UTC rather than a locale/server-dependent zone.
  assertEquals(formatExpiresOn("2026-08-24T22:30:00.000Z"), "August 24, 2026");
});

Deno.test("formatExpiresOn: undefined/null input returns undefined", () => {
  assertEquals(formatExpiresOn(undefined), undefined);
  assertEquals(formatExpiresOn(null), undefined);
});

Deno.test("formatExpiresOn: unparsable input returns undefined instead of 'Invalid Date'", () => {
  assertEquals(formatExpiresOn("not-a-date"), undefined);
});

Deno.test("resolveInviterName: prefers profiles.display_name over the auth email, and omits email once a name is known", async () => {
  // Regression: once display_name resolves, no template ever renders inviterEmail (the
  // org-invitation "Invited by" line does inviterName || inviterEmail, and name already
  // won), so the function short-circuits BEFORE calling auth.admin.getUserById, and
  // never surfaces a colleague's raw email in the result at all. usersById is seeded
  // here specifically so a regression that DID still call the Admin API would show up
  // as an unwanted `email` in the result, rather than this test passing either way.
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: { display_name: "Jane Admin" }, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { name: "Jane Admin" });
});

Deno.test("resolveInviterName: name is absent (not just falsy) when display_name is unset, leaving the email fallback to the template", async () => {
  // The org-invitation template already does inviterName || inviterEmail when it builds
  // the "Invited by" line; resolveInviterName pre-filling name with email here would make
  // that fallback dead code, so name must come back unset, not equal to email. Only this
  // (no-display_name) path reaches the Admin API call at all, since that is the one case
  // where the caller genuinely needs the email.
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: null, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { email: "jane@acme.test" });
});

Deno.test("resolveInviterName: name is absent when display_name is blank/whitespace", async () => {
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: { display_name: "   " }, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { email: "jane@acme.test" });
});

Deno.test("resolveInviterName: no inviterId returns {} (nothing to resolve)", async () => {
  const { deps } = makeFakeDeps();
  assertEquals(await resolveInviterName(deps, null), {});
  assertEquals(await resolveInviterName(deps, undefined), {});
});

Deno.test("ORG_INVITATION_EXPIRY_DAYS matches the renewal window used for stable invitations", async () => {
  // Regression: ORG_INVITATION_EXPIRY_DAYS is a hand-kept TS twin of the DB default, with
  // exactly one consumer left: org-invitation.tsx's previewData.expiresOn (the Settings >
  // Email templates preview's sample date; every real send states the row's actual
  // expires_at instead, see the removed step-back helper). expiryFallback does NOT read this
  // constant, on purpose (see its own doc comment in emailCopy.ts). This reads the
  // migration SQL back, the same guard pattern src/lib/capabilityDefaultsSql.test.ts uses
  // for capability_default(), so a future change to the column default without a matching
  // edit here fails a test instead of silently leaving the preview stale.
  const migrationsDir = new URL("../../migrations/", import.meta.url);
  const filenames: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(".sql")) filenames.push(entry.name);
  }
  filenames.sort();
  assertEquals(filenames.length > 0, true, "expected to find migration files to scan");

  // Scoped specifically to the org_invitations.expires_at column default (not a bare
  // "interval 'N days'" scan, which would also match unrelated intervals elsewhere in the
  // migrations). Sorted-filename order + "last match wins" mirrors how Postgres itself
  // would apply an ALTER COLUMN ... SET DEFAULT in a later migration, so this guard keeps
  // working if the default is ever changed rather than only defined once.
  const pattern = /v_expires_at\s+timestamptz\s*:=\s*now\(\)\s*\+\s*interval\s+'(\d+)\s+days?'/i;
  let daysFound: number | undefined;
  let sourceFile: string | undefined;
  for (const filename of filenames) {
    const sql = await Deno.readTextFile(new URL(filename, migrationsDir));
    const match = sql.match(pattern);
    if (match) {
      daysFound = Number(match[1]);
      sourceFile = filename;
    }
  }

  assertEquals(daysFound !== undefined, true, "no org_invitations.expires_at default found in any migration");
  assertEquals(
    daysFound,
    ORG_INVITATION_EXPIRY_DAYS,
    `ORG_INVITATION_EXPIRY_DAYS must match the ${sourceFile} column default`,
  );
});

Deno.test("org-invitation.expiryFallback never pins an exact day count that could drift out of sync with the dated line's own conservative rendering", () => {
  // Regression: this copy used to hardcode "14 days" (matching ORG_INVITATION_EXPIRY_DAYS
  // exactly), while the dated line every real send actually renders (expiryLine, via
  // formatExpiresOn) states the same window exactly, so a drifted constant here would
  // cross-timezone safety. Stating a firmer, longer-sounding number here than the line
  // most invitees actually see is misleading, so this copy states no day count at all;
  // pin only that no stray digit has crept back in.
  assertEquals(/\d/.test(EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"]), false);
});

Deno.test("SYSTEM_INVITER_NAME reads straight off the editable copy registry, not a hardcoded literal", () => {
  // provision-org sends this for its first-admin invite (the recipient is a stranger to
  // the platform operator, see the doc comment on org-invitation.inviterFallback in
  // emailCopy.ts). Pinning it here means a future edit to the copy default is exercised
  // by this constant instead of leaving a stale duplicate string behind in provision-org.
  assertEquals(SYSTEM_INVITER_NAME, EMAIL_COPY_DEFAULTS["org-invitation.inviterFallback"]);
  assertEquals(SYSTEM_INVITER_NAME, "the ShowFlow team");
});

// ── resolveArtistOffersExpected ──────────────────────────────────────────────
// Regression coverage for the gap where the org-invitation email promised emailed
// booking offers in org states where no offer can ever actually be sent: an org whose
// booking_flow module is unentitled, and a freshly provisioned org whose booking_flow is
// still in the "off" preset (active: false), both used to read as "offers coming"
// because the OLD computation read resolveBookingFlow(...).artist_acceptance alone,
// which fails OPEN to BOOKING_FLOW_DEFAULTS (artist_acceptance: true) in exactly those
// two cases.

Deno.test("resolveArtistOffersExpected: true when entitled, active, and artist_acceptance all check out", async () => {
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", key: "booking_flow", value: { active: true, artist_acceptance: true } }], error: null },
      ],
    },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), true);
});

Deno.test("resolveArtistOffersExpected: true with NO stored override, since BOOKING_FLOW_DEFAULTS is active + artist_acceptance", async () => {
  // The common case: most orgs never touch booking_flow at all.
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: true, error: null } },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), true);
});

Deno.test("resolveArtistOffersExpected: false for a direct-book org (artist_acceptance: false), even though it is entitled and active", async () => {
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", key: "booking_flow", value: { artist_acceptance: false } }], error: null },
      ],
    },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), false);
});

Deno.test("resolveArtistOffersExpected: false when the module is unentitled, regardless of what resolveBookingFlow falls back to", async () => {
  // The exact regression: resolveBookingFlow ALONE would return BOOKING_FLOW_DEFAULTS
  // here (artist_acceptance: true) since it fails open to the defaults on an unentitled
  // org, which is why this function checks the entitlement itself instead of trusting
  // resolveBookingFlow's return value.
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), false);
});

Deno.test("resolveArtistOffersExpected: false when the flow is paused (active: false), the exact seed provision-org writes for every freshly provisioned org with booking enabled", async () => {
  // The other half of the regression: an org entitled to booking_flow but still in the
  // "off" preset (see provision-org's offFlow seed, normalizeBookingFlow({active:false})).
  // artist_acceptance is left unset in that stored row, so it defaults true; without
  // also checking flow.active this would incorrectly read as "offers coming".
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", key: "booking_flow", value: { active: false } }], error: null },
      ],
    },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), false);
});

Deno.test("resolveArtistOffersExpected: false when the entitlement RPC itself errors, not the fail-open true that routing through checkFeature would produce", async () => {
  // The blocker this closes: checkFeature's own booking_flow fail-open reads
  // `{ data, error }` off the RPC and RETURNS true on an error, it never throws, so a
  // try/catch wrapped around a call to checkFeature can never observe an
  // is_feature_enabled fault at all. Before the fix, this exact seed made
  // resolveArtistOffersExpected return true for an org whose entitlement state is
  // actually unknown, which would render roleIntroArtistOffers ("You will get emailed
  // booking offers...") on a promise that org might never be able to keep. Calling the
  // RPC directly (see the doc comment above the function) and reading `error` ourselves
  // is what gives this function its own, opposite (fail-CLOSED) direction.
  const { deps } = makeFakeDeps({
    rpcs: { is_feature_enabled: { data: null, error: { message: "db blip", code: "57014" } } },
  });
  assertEquals(await resolveArtistOffersExpected(deps.admin, "org-1"), false);
});

// ── resendIdempotencyKey ──────────────────────────────────────────────────────

Deno.test("resendIdempotencyKey: the same inviteId/resentCount/now bucket always mints the same key", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const a = resendIdempotencyKey("inv1", 0, now);
  const b = resendIdempotencyKey("inv1", 0, now);
  assertEquals(a, b);
});

Deno.test("resendIdempotencyKey: a higher resentCount mints a different key even at the same instant", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const a = resendIdempotencyKey("inv1", 0, now);
  const b = resendIdempotencyKey("inv1", 3, now);
  assertEquals(a === b, false);
});

Deno.test("resendIdempotencyKey: real time crossing a bucket boundary mints a different key even with an unchanged (stale) resentCount", () => {
  // The regression this guards: mark_invitation_resent's write is best-effort. If it
  // silently fails after a real send succeeded, the next resend request re-reads the
  // SAME resentCount. Without a time component, that request would mint the identical
  // key and Resend would dedupe it against the first send for up to 24 hours, silently
  // swallowing a genuine later resend. A resend requested well after (here, 30 minutes,
  // several RESEND_IDEMPOTENCY_BUCKET_MS buckets later) must still get a fresh key.
  const first = resendIdempotencyKey("inv1", 0, new Date("2026-06-01T12:00:00.000Z"));
  const muchLater = resendIdempotencyKey("inv1", 0, new Date("2026-06-01T12:30:00.000Z"));
  assertEquals(first === muchLater, false);
});

Deno.test("resendIdempotencyKey: two requests racing within the same short window still get the same key (in-flight dedupe preserved)", () => {
  // A double-click or network retry, milliseconds apart, must still dedupe at Resend.
  const first = resendIdempotencyKey("inv1", 0, new Date("2026-06-01T12:00:00.000Z"));
  const momentsLater = resendIdempotencyKey("inv1", 0, new Date("2026-06-01T12:00:00.500Z"));
  assertEquals(first, momentsLater);
});
