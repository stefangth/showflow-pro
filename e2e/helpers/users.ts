/**
 * User-management helpers for E2E tests. All operations use the service role
 * client — these are setup utilities, not part of the user-facing flow.
 *
 * Onboarding is invite-only (no signup form). For E2E we create the auth user
 * directly via `auth.admin.createUser` (which triggers the profile-only
 * `handle_new_user` trigger), then grant access by inserting an `org_memberships`
 * row in the bootstrap org — access is org membership.
 */
import { adminClient } from "./supabase";
import type { AppRole } from "../../src/config/app.config";

/** The single bootstrap org all pre-multi-tenant data lives in (mirrors the DB default). */
export const BOOTSTRAP_ORG_ID = "00000000-0000-0000-0000-00000000b007";

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

/** Create a confirmed auth user (triggers the profile-only `handle_new_user`). */
export async function createConfirmedUser(
  email: string,
  password: string
): Promise<SeededUser> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createConfirmedUser failed for ${email}: ${error?.message}`);
  }
  return { id: data.user.id, email, password };
}

/** Find a user by email; null if not present. */
export async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const admin = adminClient();
  // listUsers is paginated; loop until we find or exhaust.
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`findUserByEmail failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
    page += 1;
  }
}

/**
 * Ensure a user exists and is a member of the bootstrap org with the given role.
 * Idempotent. Access is org membership, so the membership row is what lets the
 * user past ProtectedRoute's org gate.
 */
export async function ensureUserWithRole(
  email: string,
  password: string,
  role: AppRole
): Promise<SeededUser> {
  const admin = adminClient();
  let existing = await findUserByEmail(email);

  if (!existing) {
    const created = await createConfirmedUser(email, password);
    existing = { id: created.id };
  } else {
    // Reset password so the test password is known.
    await admin.auth.admin.updateUserById(existing.id, { password });
  }

  await admin
    .from("org_memberships")
    .upsert(
      { org_id: BOOTSTRAP_ORG_ID, user_id: existing.id, role },
      { onConflict: "org_id,user_id,role" }
    );

  return { id: existing.id, email, password };
}

/** Delete a test user entirely (auth.users cascades to org_memberships + app tables). */
export async function deleteUserByEmail(email: string): Promise<void> {
  const existing = await findUserByEmail(email);
  if (!existing) return;
  const admin = adminClient();
  await admin.auth.admin.deleteUser(existing.id);
}

/** Ensure a user exists, knows `password`, and is a platform (super) admin. */
export async function ensurePlatformAdmin(email: string, password: string): Promise<SeededUser> {
  const admin = adminClient();
  let existing = await findUserByEmail(email);
  if (!existing) {
    const created = await createConfirmedUser(email, password);
    existing = { id: created.id };
  } else {
    await admin.auth.admin.updateUserById(existing.id, { password });
  }
  await admin.from("platform_admins").upsert({ user_id: existing.id });
  return { id: existing.id, email, password };
}
