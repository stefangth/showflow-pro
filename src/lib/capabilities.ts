// Per-org capability flags ("user rights"). Pure logic only, no DB access.
// MIRROR: supabase/functions/_shared/capabilities.ts carries the same
// registry + resolvers (the two runtimes cannot share an import). Change
// both files in the same commit. SQL twin: public.is_capability_enabled().
//
// Capabilities are permission GRANTS (who may do an action), distinct from
// module entitlements (whether a feature exists; see entitlements.ts).

// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type CapabilityKey = "producer_can_invite";

export interface CapabilityDef {
  key: CapabilityKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityDef> = {
  producer_can_invite: {
    key: "producer_can_invite",
    label: "Producers can invite artists",
    description: "Allow producers (not just admins) to invite artists to the app.",
    defaultEnabled: false,
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

export function enabledCapabilities(rows: CapabilityRow[]): Set<CapabilityKey> {
  const byKey = new Map(rows.map((r) => [r.capability, r.enabled]));
  return new Set(CAPABILITY_KEYS.filter((k) => byKey.get(k) ?? CAPABILITY_REGISTRY[k].defaultEnabled));
}

export function isCapabilityEnabled(rows: CapabilityRow[], capability: CapabilityKey): boolean {
  return enabledCapabilities(rows).has(capability);
}
// <<< CAPABILITY REGISTRY MIRROR <<<
