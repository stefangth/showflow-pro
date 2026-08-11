import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import type { TablesInsert } from "../_shared/database.types.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedUser, formatExpiresOn, resolveArtistOffersExpected, resolveInviterName, sendOrgInvitationEmail } from "../_shared/invitations.ts";
import { roleLabel } from "../_shared/roles.ts";

type Body = {
  org_id: string;
  email: string;
  role: 'admin' | 'producer' | 'artist';
  app_origin: string;
  /** Optional: link the invite to an existing catalog artist (forces role 'artist'). */
  artist_id?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared by the two duplicate-pending paths (the invite-time membership branch and the
// 23505 unique-violation backstop) so a future copy edit can't update one and miss the other.
const PENDING_INVITE_ERROR = "That email already has a pending invitation.";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = body?.email?.trim().toLowerCase();
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.org_id || !email || !body?.role || !appOrigin) {
      return json({ error: 'Invalid payload' }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email address' }, 400);
    if (!['admin', 'producer', 'artist'].includes(body.role)) {
      return json({ error: 'Invalid role' }, 400);
    }

    // Admins & super-admins may invite any role (unchanged). A caller who is only
    // a producer may invite ONLY artists, and ONLY when producer_can_invite is on.
    // requireOrgRole returns just { ok, userId } (no role), so we gate twice.
    const adminAuth = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    let inviterId: string;
    if (adminAuth.ok) {
      inviterId = adminAuth.userId!;
    } else {
      const prodAuth = await requireOrgRole(deps, req, body.org_id, ["producer"]);
      if (!prodAuth.ok) return prodAuth.response;
      // Gate on the RAW requested role, before the artist_id path (below) coerces
      // role to 'artist'. Producers legitimately invite via { artist_id, role: 'artist' };
      // any producer request with role !== 'artist' must be rejected here.
      if (body.role !== "artist") return json({ error: "producers_can_only_invite_artists" }, 403);
      const capGate = await requireCapability(deps, body.org_id, "producer_can_invite");
      if (capGate) return capGate;
      inviterId = prodAuth.userId!;
    }

    const admin = deps.admin;

    // Optional artist_id: deterministic link from the artist surface. Validate against
    // the service client and force role 'artist' when linking a catalog artist.
    let role: Body["role"] = body.role;
    const artistId = typeof body.artist_id === "string" ? body.artist_id : undefined;
    if (artistId) {
      const { data: artist } = await admin
        .from("artists").select("id, org_id, user_id").eq("id", artistId).maybeSingle();
      const a = artist as { org_id?: string; user_id?: string | null } | null;
      if (!a || a.org_id !== body.org_id) {
        return json({ error: "Artist not found in this organization" }, 400);
      }
      if (a.user_id) {
        return json({ error: "That artist already has an account" }, 400);
      }
      role = "artist";
    }

    // Server-side duplicate guard. The People pane's live duplicate detection is a
    // UX aid only — enforce it here so a direct call, a stale page, or two admins in
    // the same window can't create a redundant invite. Already-a-member is checked
    // explicitly; an existing *pending* invite for the same email is enforced by the
    // partial unique index on (org_id, lower(email)) WHERE status='pending' and mapped
    // from the 23505 below (revoked/accepted invites stay re-invitable).
    const { data: existingUserId } = await admin.rpc("get_user_id_by_email", { p_email: email });
    if (existingUserId) {
      const { data: membership } = await admin
        .from("org_memberships")
        .select("user_id")
        .eq("org_id", body.org_id)
        .eq("user_id", existingUserId as string)
        // org_memberships holds one row PER ROLE, so a multi-role member returns
        // several rows for (org_id, user_id); cap at one to avoid PostgREST's
        // "multiple rows returned" error on .maybeSingle() (same as _shared/auth.ts).
        .limit(1)
        .maybeSingle();
      if (membership) {
        // Membership is now created at invite time (migration 20260809170001), so a
        // still-PENDING invitee already has an org_memberships row and would trip this
        // member check. Prefer the accurate "pending invitation" message when a live
        // invite exists; only a genuine member (no pending invite) gets the member 409.
        const { data: pendingInvite } = await admin
          .from("org_invitations")
          .select("id")
          .eq("org_id", body.org_id)
          .eq("email", email)
          .eq("status", "pending")
          .limit(1)
          .maybeSingle();
        if (pendingInvite) {
          return json({ error: PENDING_INVITE_ERROR }, 409);
        }
        return json({ error: "That email already belongs to a member of this organization." }, 409);
      }
    }

    const insertRow: TablesInsert<"org_invitations"> = { org_id: body.org_id, email, role, invited_by: inviterId };
    if (artistId) insertRow.artist_id = artistId;

    // Insert the invitation (token / status / expires_at use DB defaults) and read it back.
    const { data: invite, error: insErr } = await admin
      .from('org_invitations')
      .insert(insertRow)
      .select('id, org_id, email, role, status, token, expires_at, artist_id')
      .single();
    if (insErr || !invite) {
      // 23505 = unique_violation on the pending-invite index → a live invite exists.
      if ((insErr as { code?: string } | null)?.code === "23505") {
        return json({ error: PENDING_INVITE_ERROR }, 409);
      }
      return json({ error: insErr?.message ?? 'Could not create invitation' }, 500);
    }

    // Membership at invite time (best-effort, mirroring provision-org). A failure here does
    // NOT fail the request: the invitation row exists and claim_my_invitations reconciles
    // membership on the invitee's first sign-in.
    let userId: string | null = (existingUserId as string | null) ?? null;
    let actionLink: string | undefined;
    let isNewUser: boolean | undefined;
    try {
      // Mint the right link for EVERY invitee (net-new → set-password invite link; existing →
      // magic link, incl. passwordless/expired), the same way provision-org/resend-invitation do,
      // so the email always carries a working way in. Reusing existingUserId alone would skip the
      // mint for an existing non-member and dead-end them on the bare token link.
      const ensured = await ensureInvitedUser(deps, { email: invite.email, appOrigin, token: invite.token });
      userId = ensured.userId ?? userId;
      actionLink = ensured.actionLink;
      isNewUser = ensured.isNewUser;
      if (userId) {
        const { error: memErr } = await admin.rpc("ensure_invitation_membership", {
          p_invitation: invite.id, p_user: userId,
        });
        if (memErr) console.error("create-invitation: membership link failed", (memErr as { message?: string }).message);
      }
    } catch (e) {
      console.error("create-invitation: membership provisioning failed", (e as Error).message);
      // ensureInvitedUser threw before setting actionLink, which stays undefined on this
      // path. org-invitation.tsx's ctaHint checks `!actionLink` FIRST, before it ever
      // looks at isNewUser, so isNewUser has no effect on the rendered email here
      // regardless of what it is set to; leaving it undefined (the existing local
      // default) is enough. See "falls back to an honest sign-in hint even when
      // isNewUser was never resolved and there is no action link" in
      // org-invitation.test.ts for the render-level proof of that precedence.
    }

    // Best-effort delivery — but only if the invitee has a usable path to authenticate:
    // an existing account (userId) or a freshly minted set-password link (actionLink). If a
    // net-new account failed to mint above (neither is set), a plain-link email would be a
    // dead end for an account-less user, so skip it; the invitation row exists and the admin
    // can resend/copy-link. A send failure still does not fail the request.
    if (userId || actionLink) {
      try {
        const { data: org } = await admin
          .from('organizations').select('name').eq('id', body.org_id).maybeSingle();
        // Best-effort: resolveInviterName is an unrelated profiles read plus an Admin API
        // call. A failure there must not skip the whole email (this caller's outer catch
        // would otherwise treat it identically to a real send failure, dropping the
        // invitee's only way in); degrade to omitting the "Invited by" line instead.
        const inviter = await resolveInviterName(deps, inviterId)
          .catch((): { name?: string; email?: string } => ({}));
        // Only relevant to an artist invite (see DeliverInviteArgs.offersExpected).
        // resolveArtistOffersExpected already fails closed to false on any error, so no
        // extra .catch is needed here (unlike resolveInviterName above, which needs one
        // to keep a Promise.all-adjacent partial failure from throwing).
        const offersExpected = role === "artist"
          ? await resolveArtistOffersExpected(admin, body.org_id)
          : undefined;
        await sendOrgInvitationEmail(deps, {
          email: invite.email,
          orgName: (org as { name?: string } | null)?.name ?? undefined,
          role: roleLabel(invite.role),
          roleKey: invite.role,
          token: invite.token,
          inviterEmail: inviter.email,
          inviterName: inviter.name,
          expiresOn: formatExpiresOn(invite.expires_at),
          isNewUser,
          offersExpected,
          appOrigin,
          idempotencyKey: `org-invitation-${invite.id}`,
          orgId: body.org_id,
          actionLink,
        });
      } catch (e) {
        console.error('create-invitation: delivery failed', (e as Error).message);
      }
    } else {
      console.error('create-invitation: skipped delivery — net-new account minting failed (no account to authenticate)');
    }

    return json({ ok: true, invitation: invite });
  } catch (e) {
    console.error('create-invitation error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
