// Per-org capability flags ("user rights"). Pure logic (the mirror block)
// plus edge-only DB-backed helpers (below the divider).
// MIRROR: src/lib/capabilities.ts carries the same registry + resolvers
// (the two runtimes cannot share an import). Change both files in the same
// commit. SQL twin: public.is_capability_enabled().
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

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

// ── Edge-only helpers (DB-backed via the is_capability_enabled RPC) ─────────
// Capabilities are permission grants; every helper here fails CLOSED (deny on
// error), unlike entitlements' booking_flow fail-open.

/** Ask the DB (via the `is_capability_enabled` RPC) whether `capability` is on for `orgId`. Fails closed. */
export async function checkCapability(
  admin: SupabaseClient,
  orgId: string,
  capability: CapabilityKey,
): Promise<boolean> {
  const { data, error } = await admin.rpc("is_capability_enabled", { _org: orgId, _capability: capability });
  if (error) return false;
  return data === true;
}

/** Edge gate: 403 `{ error: "capability_disabled" }` when `capability` is off for `orgId`, else null. */
export async function requireCapability(
  deps: Deps,
  orgId: string,
  capability: CapabilityKey,
): Promise<Response | null> {
  return (await checkCapability(deps.admin, orgId, capability)) ? null : json({ error: "capability_disabled" }, 403);
}
