import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedUser, sendOrgInvitationEmail } from "../_shared/invitations.ts";

type Body = { invitation_id: string; app_origin: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.invitation_id || !appOrigin) return json({ error: "Invalid payload" }, 400);

    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status")
      .eq("id", body.invitation_id)
      .maybeSingle();

    // Authorize BEFORE disclosing anything (same 403 whether missing or unauthorized).
    // Admins bypass the capability gate outright; a producer additionally needs
    // producer_can_view_linked_accounts on for this org.
    if (!invite) return json({ error: "Forbidden" }, 403);
    const adminAuth = await requireOrgRole(deps, req, invite.org_id, ["admin"]);
    if (!adminAuth.ok) {
      const prodAuth = await requireOrgRole(deps, req, invite.org_id, ["producer"]);
      if (!prodAuth.ok) return prodAuth.response;
      const capGate = await requireCapability(deps, invite.org_id, "producer_can_view_linked_accounts");
      if (capGate) return capGate;
    }

    if (invite.status !== "pending") return json({ error: "Invitation is not pending" }, 409);

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();

    // Resolve the invitee account, idempotently re-assert their membership (covers the
    // stranded/hand-created cases from the runbook), then resend a fresh action link.
    const { userId, actionLink } = await ensureInvitedUser(deps, {
      email: invite.email, appOrigin, token: invite.token,
    });
    if (userId) {
      const { error: memErr } = await deps.admin.rpc("ensure_invitation_membership", {
        p_invitation: invite.id, p_user: userId,
      });
      if (memErr) console.error("resend-invitation: membership link failed", (memErr as { message?: string }).message);
    }
    await sendOrgInvitationEmail(deps, {
      email: invite.email,
      orgName: (org as { name?: string } | null)?.name ?? undefined,
      role: invite.role,
      token: invite.token,
      appOrigin,
      idempotencyKey: `org-invitation-resend-${invite.id}`,
      orgId: invite.org_id,
      actionLink,
    });

    return json({ ok: true });
  } catch (e) {
    console.error("resend-invitation error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
