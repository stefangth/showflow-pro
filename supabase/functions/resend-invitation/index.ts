import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { emailWasSent, realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedUser, formatExpiresOn, resolveInviterName, sendOrgInvitationEmail } from "../_shared/invitations.ts";
import { roleLabel } from "../_shared/roles.ts";

type Body = { invitation_id: string; app_origin: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.invitation_id || !appOrigin) return json({ error: "Invalid payload" }, 400);

    // The invitation row's own expires_at is the single source of truth for the expiry
    // statement (see the Global Constraints in the admin-journey-gaps plan): a resend
    // does not push the window out, it just restates whatever the row already says.
    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status, invited_by, expires_at")
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

    // status stays 'pending' forever (nothing flips it to 'expired'; accept_invitation
    // checks expires_at > now() at accept time instead), so the check above does not
    // catch an invitation whose window already passed. A resend never pushes expires_at
    // out (see the comment on the read below), so left unguarded this would email a
    // concrete PAST date ("works until 1 January 2026...") attached to a link
    // accept_invitation will reject regardless. Catch it here, before any email sends,
    // and point the admin at the one path that actually works: revoke, then re-invite
    // (create-invitation's pending-invite unique index blocks a second pending row for
    // the same email while this one still exists).
    const expiresOn = formatExpiresOn(invite.expires_at);
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= deps.now().getTime()) {
      return json({ error: `This invitation expired on ${expiresOn}. Revoke it, then send a fresh invite.` }, 409);
    }

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();

    // Resolve the invitee account, idempotently re-assert their membership (covers the
    // stranded/hand-created cases from the runbook), then resend a fresh action link.
    const { userId, actionLink, isNewUser } = await ensureInvitedUser(deps, {
      email: invite.email, appOrigin, token: invite.token,
    });
    if (userId) {
      const { error: memErr } = await deps.admin.rpc("ensure_invitation_membership", {
        p_invitation: invite.id, p_user: userId,
      });
      if (memErr) console.error("resend-invitation: membership link failed", (memErr as { message?: string }).message);
    }
    // Unlike create-invitation and provision-org (where the row/org just created is the
    // artifact and the email is a bonus), a RESEND's entire deliverable IS the email: the
    // membership work above already succeeded whether or not the email goes out, so a
    // silent { ok: true } here would tell the caller "done" while the invitee gets
    // nothing. Gate the response on emailWasSent (see _shared/deps.ts) instead of assuming
    // a call that didn't throw means delivery happened, and surface both failure shapes
    // (a thrown error and a resolved-but-unsuccessful send) as one honest error response.
    try {
      const inviter = await resolveInviterName(deps, invite.invited_by);
      const result = await sendOrgInvitationEmail(deps, {
        email: invite.email,
        orgName: (org as { name?: string } | null)?.name ?? undefined,
        role: roleLabel(invite.role),
        roleKey: invite.role,
        token: invite.token,
        inviterEmail: inviter.email,
        inviterName: inviter.name,
        expiresOn,
        isNewUser,
        appOrigin,
        idempotencyKey: `org-invitation-resend-${invite.id}`,
        orgId: invite.org_id,
        actionLink,
      });
      if (!emailWasSent(result)) {
        console.error("resend-invitation: email did not send", result.error ?? result.data);
        // A suppressed address (hard bounce / unsubscribe, see send-transactional-email)
        // stays suppressed until the row leaves suppressed_emails: retrying can never
        // succeed for it, so the generic "try again" copy below would be a false
        // promise. Tell the admin the real, permanent reason instead. `pref_disabled`
        // cannot actually reach this branch (org-invitation has no notification
        // category, see EMAIL_TEMPLATE_CATEGORY in _shared/notificationCategories.ts)
        // but is deliberately not special-cased: an unrecognized/absent reason falls
        // through to the transient-failure copy below, which stays true for it too.
        const reason = (result.data as { reason?: string } | null | undefined)?.reason;
        if (reason === "email_suppressed") {
          return json({
            error: "That address has unsubscribed or previously bounced, so ShowFlow will not email it. Ask them to check spam, or invite a different address.",
          }, 422);
        }
        return json({ error: "Could not resend the invitation email. Try again in a moment." }, 502);
      }
    } catch (e) {
      console.error("resend-invitation: delivery failed", (e as Error).message);
      return json({ error: "Could not resend the invitation email. Try again in a moment." }, 502);
    }

    // Delivery confirmed above (any failure already returned 422/502). Stamp the resend so
    // other admins can see WHEN (and how often) it was last resent. Best-effort: a failed
    // stamp on a real send must not fail the request (just a stale counter).
    try {
      const { error: stampErr } = await deps.admin.rpc("mark_invitation_resent", { p_id: invite.id });
      if (stampErr) console.error("resend-invitation: mark-resent failed", (stampErr as { message?: string }).message);
    } catch (se) {
      console.error("resend-invitation: mark-resent threw", (se as Error).message);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("resend-invitation error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
