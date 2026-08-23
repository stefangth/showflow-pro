import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { GETRUNNING_V3 } from "@/config/flags";

/** app_settings key for the per-org runtime override of the v3 Get running board.
 *  Unmapped in app_setting_capability, so the DB write RLS falls back to its admin arm:
 *  any org admin (as well as a super-admin) can write this key at the data layer. The
 *  super-admin-only restriction is enforced in the UI (`GetRunningV3Toggle`), NOT in the
 *  database. Rollout is a super-admin-driven, org-scoped, non-sensitive UI preview, so this
 *  gap only lets an org admin opt their own org into a slated-for-rollout board early.
 *  Hardening to super-admin-only would need a dedicated `is_super_admin` RLS policy on this
 *  key (deferred; see PR #339 review). */
export const GETRUNNING_V3_SETTING_KEY = "getrunning_v3_enabled";

/** Effective "is the v3 board live for this org": per-org app_settings row if present,
 *  else the build-time GETRUNNING_V3 default (on in local dev, off in prod). */
export async function fetchGetRunningV3Enabled(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<boolean> {
  return resolveOrgSetting<boolean>(client, orgId, GETRUNNING_V3_SETTING_KEY, GETRUNNING_V3);
}

/** Super-admin sets (or clears) the org's v3 override. */
export async function setGetRunningV3Enabled(
  client: SupabaseClient<Database>,
  orgId: string,
  enabled: boolean,
): Promise<void> {
  await upsertOrgSetting(client, orgId, GETRUNNING_V3_SETTING_KEY, enabled);
}
