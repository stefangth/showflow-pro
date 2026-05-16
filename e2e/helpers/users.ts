/**
 * User-management helpers for E2E tests. All operations use the service role
 * client — these are setup utilities, not part of the user-facing flow.
 *
 * Signup in the real app goes through Google OAuth (no email/password signup
 * form exists). For E2E we use `auth.admin.createUser` directly, which still
 * triggers the `handle_new_user` DB trigger and inserts a pending row into
 * `user_approvals` — the same end state OAuth signup produces.
 */
import { adminClient } from "./supabase";
import type { AppRole } from "../../src/config/app.config";

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

/** Create a confirmed auth user. Triggers `handle_new_user` → pending approval. */
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

/** Ensure a user exists, is approved, and has the given role. Idempotent. */
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

  // Force approval row to approved.
  await admin
    .from("user_approvals")
    .upsert(
      {
        user_id: existing.id,
        email,
        display_name: email,
        status: "approved",
        requested_role: role,
      },
      { onConflict: "user_id" }
    );

  // Ensure the role row exists.
  await admin
    .from("user_roles")
    .upsert({ user_id: existing.id, role }, { onConflict: "user_id,role" });

  return { id: existing.id, email, password };
}

/** Reset a user's approval row to pending and drop any roles. Used by the signup-approval flow. */
export async function resetUserToPending(userId: string, email: string): Promise<void> {
  const admin = adminClient();
  await admin.from("user_roles").delete().eq("user_id", userId);
  await admin
    .from("user_approvals")
    .upsert(
      {
        user_id: userId,
        email,
        display_name: email,
        status: "pending",
        requested_role: "artist",
        decided_by: null,
        decided_at: null,
        rejection_reason: null,
      },
      { onConflict: "user_id" }
    );
}

/** Delete a test user entirely (auth.users cascades to most app tables). */
export async function deleteUserByEmail(email: string): Promise<void> {
  const existing = await findUserByEmail(email);
  if (!existing) return;
  const admin = adminClient();
  // Clean child rows that don't cascade by user_id.
  await admin.from("user_roles").delete().eq("user_id", existing.id);
  await admin.from("user_approvals").delete().eq("user_id", existing.id);
  await admin.auth.admin.deleteUser(existing.id);
}
