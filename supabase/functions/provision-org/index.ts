import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deliverOrgInvitation } from "../_shared/invitations.ts";
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
      if (bookingEnabled) {
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

    // Bootstrap + branded invite via the unified helper (net-new gets an account + set-password link).
    try {
      const inviter = auth.userId ? await deps.admin.auth.admin.getUserById(auth.userId) : null;
      await deliverOrgInvitation(deps, {
        email,
        orgName: name,
        role,
        token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin,
        idempotencyKey: `org-invitation-${org_id}`,
        orgId: org_id,
      });
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
