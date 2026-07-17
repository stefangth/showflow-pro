// Per-org feature entitlements ("modules"). Pure logic (this file's top half)
// plus edge-only DB-backed helpers (bottom half, Task 6).
// MIRROR: src/lib/entitlements.ts carries the same registry + resolvers
// (the two runtimes cannot share an import). Change both files in the
// same commit. SQL twin: public.is_feature_enabled().
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

export type FeatureKey = "booking_flow" | "hire_orders";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Compact chip label for dense fleet views (e.g. the platform Organizations table). */
  short: "BF" | "HO";
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDef> = {
  booking_flow: {
    key: "booking_flow",
    label: "Booking flow",
    description: "Configurable offer, escalation and confirmation automation.",
    defaultEnabled: true,
    short: "BF",
  },
  hire_orders: {
    key: "hire_orders",
    label: "Hire orders",
    description: "PDF engagement sheets with delivery and countersignature.",
    defaultEnabled: false,
    short: "HO",
  },
};

export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];

export interface EntitlementRow {
  feature: string;
  enabled: boolean;
}

export function enabledFeatures(rows: EntitlementRow[]): Set<FeatureKey> {
  const byKey = new Map(rows.map((r) => [r.feature, r.enabled]));
  return new Set(FEATURE_KEYS.filter((k) => byKey.get(k) ?? FEATURE_REGISTRY[k].defaultEnabled));
}

export function isFeatureEnabled(rows: EntitlementRow[], feature: FeatureKey): boolean {
  return enabledFeatures(rows).has(feature);
}

// ── Edge-only helpers (DB-backed via the is_feature_enabled RPC) ────────────
// Everything below touches the database (through a SupabaseClient / Deps) and
// therefore has no frontend mirror — src/lib/entitlements.ts stays pure.

/**
 * Ask the DB (via the `is_feature_enabled` RPC) whether `feature` is on for `orgId`.
 *
 * Fails CLOSED for every feature except `booking_flow`, which fails OPEN on an RPC
 * error — the booking engine is live production traffic (six cron/request-driven
 * consumers via resolveBookingFlow) and must never be silently disabled by a
 * transient RPC failure. New/optional features (e.g. hire_orders) default to
 * unavailable on error instead, since being unreachable is safer than exposing a
 * half-built module.
 */
export async function checkFeature(
  admin: SupabaseClient,
  orgId: string,
  feature: FeatureKey,
): Promise<boolean> {
  const { data, error } = await admin.rpc("is_feature_enabled", { _org: orgId, _feature: feature });
  if (error) return feature === "booking_flow";
  return data === true;
}

/**
 * Edge-function gate: 403s with `{ error: "feature_disabled" }` when `feature` is
 * off for `orgId`, else returns null so the handler can continue. Deliberately a
 * simple `Response | null` contract (not the `AuthOutcome` union `_shared/auth.ts`
 * uses for identity checks) since this only ever needs a boolean gate, no userId.
 */
export async function requireFeature(
  deps: Deps,
  orgId: string,
  feature: FeatureKey,
): Promise<Response | null> {
  return (await checkFeature(deps.admin, orgId, feature)) ? null : json({ error: "feature_disabled" }, 403);
}

/** Filter a list of orgs down to those entitled to `feature` (one RPC call per org). */
export async function filterEntitledOrgs(
  admin: SupabaseClient,
  orgs: Array<{ id: string }>,
  feature: FeatureKey,
): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (const org of orgs) {
    if (await checkFeature(admin, org.id, feature)) out.push(org);
  }
  return out;
}
