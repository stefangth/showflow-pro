import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";

/** The org's chosen source of truth for the get-running dates wizard. `null`
 *  means no source has been chosen yet (or the stored value is unrecognized). */
export type DatesSource = "airtable" | "sheet" | "manual" | null;

const KEY = "getrunning_dates_source";
const VALID = new Set<Exclude<DatesSource, null>>(["airtable", "sheet", "manual"]);

function isValidSource(value: string): value is Exclude<DatesSource, null> {
  return VALID.has(value as Exclude<DatesSource, null>);
}

/** Effective dates-source setting for the org (org override over platform default),
 *  or null when unset or the stored value isn't one of the recognized sources. */
export async function fetchDatesSource(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<DatesSource> {
  const raw = await resolveOrgSetting<string | null>(client, orgId, KEY, null);
  return raw && isValidSource(raw) ? raw : null;
}

/** Persist the org's chosen dates source as an org-scoped app_settings override. */
export async function saveDatesSource(
  client: SupabaseClient<Database>,
  orgId: string,
  source: Exclude<DatesSource, null>,
): Promise<void> {
  await upsertOrgSetting(client, orgId, KEY, source);
}
