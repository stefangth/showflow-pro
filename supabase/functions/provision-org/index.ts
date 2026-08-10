import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedUser, formatExpiresOn, resolveInviterName, sendOrgInvitationEmail } from "../_shared/invitations.ts";
import { roleLabel } from "../_shared/roles.ts";
import { resolveOrgSetting } from "../_shared/settings.ts";
import { FEATURE_KEYS, FEATURE_REGISTRY, type FeatureKey } from "../_shared/entitlements.ts";
import { normalizeBookingFlow } from "../_shared/bookingFlow.ts";
import type { Json } from "../_shared/database.types.ts";

type Body = {
  name: string;
  slug: string;
  admin_email: string;
  role?: "admin" | "producer" | "artist";
  app_origin: string;
  entitlements?: Record<string, boolean>;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Body | null;
    const name = body?.name?.trim();
    const slug = body?.slug?.trim().toLowerCase();
    const email = body?.admin_email?.trim().toLowerCase();
    const role = body?.role ?? "admin";
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!name || !slug || !email || !appOrigin) return json({ error: "Invalid payload" }, 400);
    if (!["admin", "producer", "artist"].includes(role)) return json({ error: "Invalid role" }, 400);

    // Atomic DB work runs as the caller (auth.uid() = the super-admin) so provision_org's
    // internal is_super_admin check passes; SECURITY DEFINER does the privileged inserts.
    const authHeader = req.headers.get("Authorization")!;
    const { data, error } = await deps.userClient(authHeader)
      .rpc("provision_org", { p_name: name, p_slug: slug, p_admin_email: email, p_role: role });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return json({ error: "That slug is already taken" }, 409);
      return json({ error: (error as Error).message ?? "Could not provision org" }, 500);
    }
    const { org_id, token } = data as { org_id: string; token: string };

    // Seed org_entitlements. An explicit `entitlements` body from the picker wins per
    // feature (validated against FEATURE_KEYS — unknown keys are ignored); any feature it
    // omits falls back to the platform default_entitlements setting (falls back in turn to
    // each feature's registry default when that platform setting is unset). Best-effort: a
    // seeding failure must not undo the org that was just created, so log and continue —
    // same resilience posture as the invite delivery below.
    try {
      const fallbackDefaults = Object.fromEntries(
        FEATURE_KEYS.map((key) => [key, FEATURE_REGISTRY[key].defaultEnabled]),
      ) as Record<FeatureKey, boolean>;
      const defaultEntitlements = await resolveOrgSetting<Record<FeatureKey, boolean>>(
        deps.admin, null, "default_entitlements", fallbackDefaults,
      );
      const requested = body?.entitlements ?? null;
      const entitlementRows = FEATURE_KEYS.map((feature) => ({
        org_id,
        feature,
        enabled: requested && typeof requested[feature] === "boolean"
          ? requested[feature]
          : (defaultEntitlements[feature] ?? FEATURE_REGISTRY[feature].defaultEnabled),
      }));
      const { error: entitlementsError } = await deps.admin.from("org_entitlements").insert(entitlementRows);
      if (entitlementsError) console.error("provision-org: entitlement seeding failed", entitlementsError.message);

      // Land a freshly enabled booking_flow in the "off" state so the org doesn't start
      // dispatching offers before someone configures it. Best-effort, same posture as above.
      const bookingEnabled = entitlementRows.find((r) => r.feature === "booking_flow")?.enabled ?? false;
      // Only seed the off-flow row if the entitlement insert actually landed — otherwise the
      // two writes could disagree (an off flow row for an org whose entitlements never wrote).
      if (!entitlementsError && bookingEnabled) {
        try {
          const offFlow = normalizeBookingFlow({ active: false });
          const { error: flowErr } = await deps.admin.from("app_settings")
            .upsert({ org_id, key: "booking_flow", value: offFlow as unknown as Json }, { onConflict: "org_id,key" });
          if (flowErr) console.error("provision-org: off-flow seed failed", flowErr.message);
        } catch (e) {
          console.error("provision-org: off-flow seed failed", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("provision-org: entitlement seeding failed", (e as Error).message);
    }

    // Resolve the invitation id created inside provision_org (it returns only {org_id, token}),
    // then create the first-admin's account + membership NOW, before the branded email.
    // Best-effort/logged: the org + invitation already exist and claim_my_invitations
    // self-heals on the admin's first sign-in, so a link failure must not undo the org.
    try {
      const { data: invRow } = await deps.admin
        .from("org_invitations").select("id, expires_at").eq("token", token).maybeSingle();
      const invitationId = (invRow as { id?: string } | null)?.id;
      const { userId, actionLink, isNewUser } = await ensureInvitedUser(deps, { email, appOrigin, token });
      if (invitationId && userId) {
        const { error: memErr } = await deps.admin.rpc("ensure_invitation_membership", {
          p_invitation: invitationId, p_user: userId,
        });
        if (memErr) console.error("provision-org: membership link failed", (memErr as { message?: string }).message);
      }
      // Only email when the first admin can actually authenticate: an existing account
      // (userId) or a freshly minted set-password link (actionLink). A link-less email to an
      // account-less user is a dead end; skip it (claim_my_invitations self-heals membership
      // on their first sign-in regardless). Mirrors create-invitation's guard.
      if (userId || actionLink) {
        // The first admin of a brand-new org is a stranger to the super-admin provisioning
        // it, so the "Invited by" line should read a real name when one is on file, not the
        // platform operator's raw personal inbox address. Same resolver every other invite
        // path uses (create-invitation, resend-invitation), for a consistent "who invited me".
        const inviter = auth.userId ? await resolveInviterName(deps, auth.userId) : {};
        await sendOrgInvitationEmail(deps, {
          email, orgName: name, role: roleLabel(role), roleKey: role, token,
          inviterEmail: inviter.email,
          inviterName: inviter.name,
          expiresOn: formatExpiresOn((invRow as { expires_at?: string } | null)?.expires_at),
          isNewUser,
          appOrigin, idempotencyKey: `org-invitation-${org_id}`, orgId: org_id, actionLink,
        });
      } else {
        console.error("provision-org: skipped invite email — first-admin account minting failed");
      }
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }

    return json({ org_id });
  } catch (e) {
    console.error("provision-org error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
