import { assertEquals } from "./test-asserts.ts";
import {
  ensureInvitedUser,
  formatExpiresOn,
  formatExpiryThrough,
  ORG_INVITATION_EXPIRY_DAYS,
  resolveInviterName,
  sendOrgInvitationEmail,
  SYSTEM_INVITER_NAME,
} from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";
import { EMAIL_COPY_DEFAULTS } from "./transactional-email-templates/_shell/emailCopy.ts";

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

Deno.test("sendOrgInvitationEmail: returns the raw send result so a caller can gate a side effect on emailWasSent", async () => {
  // Regression: a caller (resend-invitation) reports the resend as FAILED to its own
  // caller when the send didn't truly deliver, rather than returning ok:true
  // unconditionally. That is only possible if this function surfaces the result instead
  // of swallowing it into a bare Promise<void>.
  const { deps } = makeFakeDeps({ emailResult: { data: { success: false, reason: "email_suppressed" }, error: null } });
  const result = await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1", actionLink: "https://link.example/invite",
  });
  assertEquals(result.error, null);
  assertEquals((result.data as { success?: unknown } | null)?.success, false);
});

Deno.test("formatExpiresOn: renders a long-form, date-only string with no time and no timezone name", () => {
  // Date-only and tenant-neutral on purpose: an org-invitation goes to a stranger who has
  // no reason to know or care what timezone the booking engine runs on, unlike the digest
  // emails which genuinely are Berlin-scheduled and say so. This is the EXACT calendar
  // day, not the guaranteed-valid one the email body actually renders; see
  // formatExpiryThrough below for that.
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

Deno.test("formatExpiryThrough: renders the day BEFORE the exact expiry day, since expires_at keeps its creation time-of-day and accept_invitation checks it to the second", () => {
  // Regression for the class of bug where the email claimed a window one day wider than
  // the DB actually honors: a row created 2026-08-10 14:30Z with the 14-day default
  // expires 2026-08-24T14:30:00Z, so "open through August 24" would be false for anyone
  // who reads the email on August 24 itself after 14:30Z. formatExpiryThrough must state
  // the prior day instead, which is guaranteed valid in full.
  assertEquals(formatExpiryThrough("2026-08-24T14:30:00.000Z"), "August 23, 2026");
});

Deno.test("formatExpiryThrough: a mid-day expiry still renders the prior calendar day, not the same day", () => {
  // The exact boundary case the fix targets: expires_at at noon, nowhere near midnight,
  // still must not render its own calendar day (only the first 12 hours of that day
  // would actually be safe to claim).
  assertEquals(formatExpiryThrough("2026-08-24T12:00:00.000Z"), "August 23, 2026");
});

Deno.test("formatExpiryThrough: even an expiry at 00:00:00 UTC (the earliest possible time-of-day) still steps back a full day", () => {
  // The tightest case: if expires_at itself were exactly midnight, the exact day would
  // actually be safe for its own full 24 hours. formatExpiryThrough still renders the
  // prior day here (a one-day-conservative rendering is always correct, just not always
  // maximally tight), keeping the function simple and its guarantee unconditional rather
  // than branching on the row's time-of-day.
  assertEquals(formatExpiryThrough("2026-08-24T00:00:00.000Z"), "August 23, 2026");
});

Deno.test("formatExpiryThrough: undefined/null input returns undefined", () => {
  assertEquals(formatExpiryThrough(undefined), undefined);
  assertEquals(formatExpiryThrough(null), undefined);
});

Deno.test("formatExpiryThrough: unparsable input returns undefined instead of 'Invalid Date'", () => {
  assertEquals(formatExpiryThrough("not-a-date"), undefined);
});

Deno.test("resolveInviterName: prefers profiles.display_name over the auth email", async () => {
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: { display_name: "Jane Admin" }, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { name: "Jane Admin", email: "jane@acme.test" });
});

Deno.test("resolveInviterName: name is undefined when display_name is unset, leaving the email fallback to the template", async () => {
  // The org-invitation template already does inviterName || inviterEmail when it builds
  // the "Invited by" line; resolveInviterName pre-filling name with email here would make
  // that fallback dead code, so name must come back unset, not equal to email.
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: null, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { name: undefined, email: "jane@acme.test" });
});

Deno.test("resolveInviterName: name is undefined when display_name is blank/whitespace", async () => {
  const { deps } = makeFakeDeps({
    tables: { profiles: { data: { display_name: "   " }, error: null } },
    usersById: { "user-1": { email: "jane@acme.test" } },
  });
  const inviter = await resolveInviterName(deps, "user-1");
  assertEquals(inviter, { name: undefined, email: "jane@acme.test" });
});

Deno.test("resolveInviterName: no inviterId returns {} (nothing to resolve)", async () => {
  const { deps } = makeFakeDeps();
  assertEquals(await resolveInviterName(deps, null), {});
  assertEquals(await resolveInviterName(deps, undefined), {});
});

Deno.test("ORG_INVITATION_EXPIRY_DAYS matches the org_invitations.expires_at column default in the migrations", async () => {
  // Regression: ORG_INVITATION_EXPIRY_DAYS is a hand-kept TS twin of the DB default,
  // used only by the generic expiryFallback copy and the Settings preview's sample date
  // (every real send states the row's actual expires_at, see formatExpiresOn). This reads
  // the migration SQL back, the same guard pattern
  // src/lib/capabilityDefaultsSql.test.ts uses for capability_default(), so a future change
  // to the column default without a matching edit here fails a test instead of silently
  // shipping an email that states a window the DB doesn't honor.
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
  const pattern = /expires_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)\s*\+\s*interval\s+'(\d+)\s+days?'/i;
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

Deno.test("org-invitation.expiryFallback stays consistent with ORG_INVITATION_EXPIRY_DAYS", () => {
  // The fallback copy states a duration in plain English rather than a {{token}} (so it
  // reads naturally in the template editor's live preview too), which means nothing type
  // checks it against the real constant. Pin the two together here so a future change to
  // ORG_INVITATION_EXPIRY_DAYS without a matching copy edit fails a test instead of
  // shipping a silently wrong invitation email.
  assertEquals(
    EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"].includes(String(ORG_INVITATION_EXPIRY_DAYS)),
    true,
  );
});

Deno.test("SYSTEM_INVITER_NAME reads straight off the editable copy registry, not a hardcoded literal", () => {
  // provision-org sends this for its first-admin invite (the recipient is a stranger to
  // the platform operator, see the doc comment on org-invitation.inviterFallback in
  // emailCopy.ts). Pinning it here means a future edit to the copy default is exercised
  // by this constant instead of leaving a stale duplicate string behind in provision-org.
  assertEquals(SYSTEM_INVITER_NAME, EMAIL_COPY_DEFAULTS["org-invitation.inviterFallback"]);
  assertEquals(SYSTEM_INVITER_NAME, "the ShowFlow team");
});
