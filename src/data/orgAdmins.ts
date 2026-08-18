import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Distinct display names of an org's admins, via `list_org_admin_names` (any member,
 * including a producer, may call it). Never throws to the caller: a read failure or an
 * admin with no display name set yet both degrade to the empty array, so a consumer like
 * BookingProducerWaitingCard can fall back to its generic "an admin" copy instead of
 * breaking the card.
 */
export async function fetchOrgAdminNames(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<string[]> {
  const { data, error } = await client.rpc("list_org_admin_names", { p_org: orgId });
  if (error) return [];
  return data ?? [];
}

/**
 * The name a "Waits on {name}" chip/action names, from `fetchOrgAdminNames`' plain string
 * array. Only the first admin is named (the `/get-running` producer board's own design
 * example — screen 03 — names exactly one), with a role-neutral `fallback` (the caller's
 * translated `waitsOn.fallbackAdmin`) for the case no admin has a display name set yet —
 * mirrors `adminAskLine` below's same empty-array case, but returns a bare name rather than
 * a full sentence, since this one has to fit inside a chip.
 */
export function adminDisplayName(names: string[] | undefined, fallback: string): string {
  return names && names.length > 0 ? names[0] : fallback;
}

/**
 * Wording for asking the org's real admins to finish setup, from their display names.
 * `null` when there is nobody to name (no admin has a display name yet), so the caller
 * falls back to its existing generic "An admin has to finish setup" copy.
 */
export function adminAskLine(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) {
    return `Ask ${names[0]} to finish setup before anyone can be booked.`;
  }
  if (names.length === 2) {
    return `Ask ${names[0]} or ${names[1]} to finish setup before anyone can be booked.`;
  }
  // 3+: names the first two by name and folds the rest into "another admin" rather than
  // listing every one of them.
  return `Ask ${names[0]}, ${names[1]} or another admin to finish setup before anyone can be booked.`;
}
