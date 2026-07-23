import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

const APP_ORIGIN = "https://app.showflow.pro";
type Action = "change_email" | "send_password_reset" | "suspend" | "unsuspend" | "delete";
interface Body { action: Action; target_user_id: string; new_email?: string }

async function audit(deps: Deps, actor: string, action: string, target: string, detail?: unknown): Promise<void> {
  await deps.admin.from("platform_audit_log").insert({
    actor_user_id: actor, action, target_user_id: target, detail: (detail ?? null) as never,
  });
}

/**
 * True when `userId` is the sole remaining super-admin. Used to block suspending or
 * deleting the last platform_admins row, which would leave the platform unmanageable.
 */
async function isLastSuperAdmin(deps: Deps, userId: string): Promise<boolean> {
  const { data } = await deps.admin.from("platform_admins").select("user_id");
  const rows = (data ?? []) as { user_id: string }[];
  return rows.length <= 1 && rows.some((r) => r.user_id === userId);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.action || !body?.target_user_id) return json({ error: "Invalid payload" }, 400);
    const admin = deps.admin;
    const actor = auth.userId!;
    const target = body.target_user_id;

    if (body.action === "change_email") {
      const newEmail = body.new_email?.trim().toLowerCase();
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return json({ error: "Invalid email" }, 400);

      const { data: current } = await admin.auth.admin.getUserById(target);
      const oldEmail = current?.user?.email ?? "";

      // Duplicate check via the existing get_user_id_by_email RPC (service-role only,
      // case-insensitive) rather than a listUsers() scan.
      const { data: dupId } = await admin.rpc("get_user_id_by_email", { p_email: newEmail });
      if (dupId && dupId !== target) return json({ error: "That email is already in use" }, 409);

      const { error: upErr } = await admin.auth.admin.updateUserById(target, { email: newEmail, email_confirm: true });
      if (upErr) throw upErr;

      if (oldEmail) {
        await deps.sendEmail({
          template_name: "account-email-changed",
          recipient_email: oldEmail,
          templateData: { oldEmail, newEmail, appOrigin: APP_ORIGIN },
        });
      }
      await deps.sendEmail({
        template_name: "account-email-changed",
        recipient_email: newEmail,
        templateData: { oldEmail, newEmail, appOrigin: APP_ORIGIN },
      });

      await audit(deps, actor, "change_email", target, { oldEmail, newEmail });
      return json({ ok: true });
    }

    if (body.action === "send_password_reset") {
      const { data: u } = await admin.auth.admin.getUserById(target);
      const email = u?.user?.email;
      if (!email) return json({ error: "User has no email" }, 400);
      const { error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      if (error) throw error;
      await audit(deps, actor, "send_password_reset", target);
      return json({ ok: true });
    }

    if (body.action === "suspend" || body.action === "unsuspend") {
      if (body.action === "suspend" && target === actor) return json({ error: "You cannot suspend yourself" }, 400);
      if (body.action === "suspend" && await isLastSuperAdmin(deps, target)) {
        return json({ error: "Cannot suspend the last super-admin" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(target, {
        ban_duration: body.action === "suspend" ? "876000h" : "none",
      });
      if (error) throw error;
      await audit(deps, actor, body.action, target);
      return json({ ok: true });
    }

    if (body.action === "delete") {
      if (target === actor) return json({ error: "You cannot delete yourself" }, 400);
      if (await isLastSuperAdmin(deps, target)) return json({ error: "Cannot delete the last super-admin" }, 400);

      // anonymize_user guards on `auth.uid() = p_user OR is_super_admin(auth.uid())`. The
      // service-role admin client has auth.uid() = null, so it must be called through the
      // CALLER's JWT client (the acting super-admin's own session), not deps.admin.
      const authHeader = req.headers.get("Authorization")!;
      const { error: anonErr } = await deps.userClient(authHeader).rpc("anonymize_user", { p_user: target });
      if (anonErr) throw anonErr;

      const { error: delErr } = await admin.auth.admin.deleteUser(target);
      if (delErr) throw delErr;

      await audit(deps, actor, "delete", target);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("platform-manage-user error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
