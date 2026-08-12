import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { emailWasSent, realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedAccount, formatExpiresOn, resendIdempotencyKey, resolveArtistOffersExpected, resolveInviterName, sendOrgInvitationEmail } from "../_shared/invitations.ts";
import { roleLabel } from "../_shared/roles.ts";

type Body = { invitation_id: string; app_origin: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.invitation_id || !appOrigin) return json({ error: "Invalid payload" }, 400);

    // Read the current row for authorization and status; renewal below returns the new
    // expiry that becomes the email's source of truth.
    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status, invited_by, expires_at, resent_count")
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

    // Renew before any delivery work. The RPC commits the new 30-day expiry independently,
    // so even a later email failure leaves the stable invitation usable for another resend.
    const { data: renewedExpiry, error: renewError } = await deps.admin.rpc(
      "renew_invitation_for_resend",
      { p_id: invite.id },
    );
    if (renewError || !renewedExpiry) throw renewError ?? new Error("Invitation renewal failed");

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();

    // Resolve the invitee account and idempotently re-assert their membership. The email
    // carries only the stable invitation token; no Auth action link is minted here.
    const { userId } = await ensureInvitedAccount(deps, {
      email: invite.email, appOrigin,
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
    //
    // The idempotency key (resendIdempotencyKey, _shared/invitations.ts) folds in
    // resent_count (the value BEFORE this send's own mark_invitation_resent bump below)
    // AND a coarse now()-bucket, not just invite.id: send-transactional-email forwards
    // this key to Resend as its `Idempotency-Key` header, which Resend treats as "the
    // same logical send" for 24 hours and replies 200 for the ORIGINAL message on any
    // repeat within that window without re-delivering. A key scoped to invite.id alone
    // would make every resend of the same invitation within 24h of the last one collapse
    // into that guarantee. resent_count alone narrows that to "within one resend
    // attempt" (two requests racing before either one's stamp lands read the same
    // resent_count and get the same key, so a double-click or network retry still
    // dedupes as intended) but mark_invitation_resent's write is best-effort: if it
    // silently fails after a real send succeeded, a later GENUINE resend would still
    // read the same stale resent_count and collide for the rest of that 24-hour window.
    // The now()-bucket bounds that exposure to minutes instead of a full day, without
    // weakening the in-flight-duplicate guarantee (see resendIdempotencyKey's own doc
    // comment for the full reasoning).
    try {
      // Best-effort: resolveInviterName is an unrelated profiles read plus an Admin API
      // call, and a failure there must not abort a resend whose email was never even
      // attempted, nor get reported to the admin as a delivery failure. Degrade to
      // omitting the "Invited by" line instead (see sendOrgInvitationEmail/org-invitation.tsx,
      // which already renders no line at all when neither name nor email is known).
      const inviter = await resolveInviterName(deps, invite.invited_by)
        .catch((): { name?: string; email?: string } => ({}));
      // Only relevant to an artist invite (see DeliverInviteArgs.offersExpected).
      // resolveArtistOffersExpected already fails closed to false on any error, so no
      // extra .catch is needed here.
      const offersExpected = invite.role === "artist"
        ? await resolveArtistOffersExpected(deps.admin, invite.org_id)
        : undefined;
      const result = await sendOrgInvitationEmail(deps, {
        email: invite.email,
        orgName: (org as { name?: string } | null)?.name ?? undefined,
        role: roleLabel(invite.role),
        roleKey: invite.role,
        token: invite.token,
        inviterEmail: inviter.email,
        inviterName: inviter.name,
        expiresOn: formatExpiresOn(renewedExpiry as string),
        offersExpected,
        appOrigin,
        idempotencyKey: resendIdempotencyKey(invite.id, invite.resent_count ?? 0, deps.now()),
        orgId: invite.org_id,
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
