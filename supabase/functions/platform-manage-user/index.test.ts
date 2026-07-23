import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer x" };
const post = (body: unknown) => new Request("http://x", { method: "POST", headers: AUTH, body: JSON.stringify(body) });

// Note: every test below sets `authUser: { id: "sa" }` even where the brief's literal
// snippet omitted it. `requireSuperAdmin` calls `deps.userClient(authHeader).auth.getUser()`
// FIRST and 401s on a null user, before it ever queries `platform_admins` — so without an
// `authUser`, every one of these would 401 rather than reach the 403/400/409/200 they're
// meant to exercise. Task 4 (`platform-list-users`) hit and documented this exact gap;
// this file follows that precedent from the start.

Deno.test("rejects non-super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(post({ action: "suspend", target_user_id: "u2" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("change_email rejects a duplicate address", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "old@test.com" }],
    authUsersByEmail: { "taken@test.com": { id: "other" } },
  });
  const res = await handle(post({ action: "change_email", target_user_id: "u2", new_email: "taken@test.com" }), deps);
  assertEquals(res.status, 409);
});

Deno.test("change_email rejects an invalid email format", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "old@test.com" }],
  });
  const res = await handle(post({ action: "change_email", target_user_id: "u2", new_email: "not-an-email" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("change_email updates + notifies both addresses", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "old@test.com" }],
  });
  const res = await handle(post({ action: "change_email", target_user_id: "u2", new_email: "new@test.com" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 2); // old + new
  const recipients = emails.map((c) => (c.body as { recipient_email: string }).recipient_email);
  assert(recipients.includes("old@test.com"));
  assert(recipients.includes("new@test.com"));
});

Deno.test("blocks self-suspend", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
  });
  const res = await handle(post({ action: "suspend", target_user_id: "sa" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("blocks suspending the last super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: [{ user_id: "u2" }], error: null } },
  });
  const res = await handle(post({ action: "suspend", target_user_id: "u2" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("suspends a user and audits the action", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    // Only "sa" is a super-admin, and the target ("u3") isn't in this list, so the
    // last-admin guard does not block this suspension.
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
    // Target is NOT the sole admin of any org, so the sole-admin guard passes too.
    rpcs: { sole_admin_orgs: { data: [], error: null } },
  });
  const res = await handle(post({ action: "suspend", target_user_id: "u3" }), deps);
  assertEquals(res.status, 200);
  assert(calls.some((c) => c.table === "platform_audit_log" && c.method === "insert"));
  const updateCall = calls.find((c) => c.table === "auth.admin.updateUserById");
  assertEquals((updateCall?.args[1] as { ban_duration?: string } | undefined)?.ban_duration, "876000h");
});

Deno.test("unsuspends a user", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
  });
  const res = await handle(post({ action: "unsuspend", target_user_id: "u3" }), deps);
  assertEquals(res.status, 200);
  const updateCall = calls.find((c) => c.table === "auth.admin.updateUserById");
  assertEquals((updateCall?.args[1] as { ban_duration?: string } | undefined)?.ban_duration, "none");
});

Deno.test("blocks suspending a user who is the sole admin of an org", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    // "sa" is the only super-admin; target "u3" is not, so the last-admin guard passes,
    // but sole_admin_orgs reports "u3" as the only admin of "Acme". Suspending them would
    // lock that org out of admin access (a banned admin cannot sign in).
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
    rpcs: { sole_admin_orgs: { data: [{ org_id: "o1", org_name: "Acme" }], error: null } },
  });
  const res = await handle(post({ action: "suspend", target_user_id: "u3" }), deps);
  assertEquals(res.status, 400);
  // The ban update never ran, proving the handler returned before applying the suspension.
  assert(!calls.some((c) => c.table === "auth.admin.updateUserById"));
  assert(!calls.some((c) => c.table === "platform_audit_log" && c.method === "insert"));
});

Deno.test("sends a password reset link via resetPasswordForEmail", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "u2@test.com" }],
  });
  const res = await handle(post({ action: "send_password_reset", target_user_id: "u2" }), deps);
  assertEquals(res.status, 200);
  // resetPasswordForEmail both mints AND sends the recovery email (generateLink only
  // mints one, which was the bug: it discarded the link and never sent anything).
  const resetCall = calls.find((c) => c.table === "auth.resetPasswordForEmail");
  assert(resetCall, "expected resetPasswordForEmail to be called");
  assertEquals(resetCall?.args[0], "u2@test.com");
  assertEquals(resetCall?.args[1], { redirectTo: "https://app.showflow.pro/reset-password" });
  assert(calls.some((c) => c.table === "platform_audit_log" && c.method === "insert"));
});

Deno.test("send_password_reset rejects a user with no email", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: null }],
  });
  const res = await handle(post({ action: "send_password_reset", target_user_id: "u2" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("delete blocks the last super-admin acting on themselves", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
  });
  const res = await handle(post({ action: "delete", target_user_id: "sa" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("deletes a user via anonymize_user then the admin delete", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    // Only "sa" is a super-admin; target "u3" is not, so the last-admin guard passes.
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
    // Target is NOT the sole admin of any org, so the sole-admin guard passes too.
    rpcs: { sole_admin_orgs: { data: [], error: null }, anonymize_user: { data: null, error: null } },
  });
  const res = await handle(post({ action: "delete", target_user_id: "u3" }), deps);
  assertEquals(res.status, 200);
  assert(calls.some((c) => c.table === "rpc:anonymize_user"));
  assert(calls.some((c) => c.table === "platform_audit_log" && c.method === "insert"));
});

Deno.test("blocks deleting a user who is the sole admin of an org", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    // Only "sa" is a super-admin; target "u3" is not, so the last-admin guard passes,
    // but sole_admin_orgs reports "u3" as the only admin of "Acme" (mirrors the shape
    // seeded in delete-my-account/index.test.ts).
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
    rpcs: { sole_admin_orgs: { data: [{ org_id: "o1", org_name: "Acme" }], error: null } },
  });
  const res = await handle(post({ action: "delete", target_user_id: "u3" }), deps);
  assertEquals(res.status, 400);
  // Neither anonymize_user nor the audit-log insert (which always follows the admin
  // deleteUser call) ran, proving the handler returned before reaching either.
  assert(!calls.some((c) => c.table === "rpc:anonymize_user"));
  assert(!calls.some((c) => c.table === "platform_audit_log" && c.method === "insert"));
});

Deno.test("rejects an unknown action", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
  });
  const res = await handle(post({ action: "not_a_real_action", target_user_id: "u2" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("rejects a payload missing target_user_id", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
  });
  const res = await handle(post({ action: "suspend" }), deps);
  assertEquals(res.status, 400);
});
