// Per-org feature entitlements ("modules"). Pure logic only, no DB access.
// MIRROR: supabase/functions/_shared/entitlements.ts carries the same
// registry + resolvers (the two runtimes cannot share an import). Change
// both files in the same commit. SQL twin: public.is_feature_enabled().

export type FeatureKey = "booking_flow" | "hire_orders";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDef> = {
  booking_flow: {
    key: "booking_flow",
    label: "Booking flow",
    description: "Configurable offer, escalation and confirmation automation.",
    defaultEnabled: true,
  },
  hire_orders: {
    key: "hire_orders",
    label: "Hire orders",
    description: "PDF engagement sheets with delivery and countersignature.",
    defaultEnabled: false,
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
