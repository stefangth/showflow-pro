import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveOrgSetting } from "./settings.ts";
import { checkFeature } from "./entitlements.ts";

// Runtime twin of src/lib/i18n/orgLanguage.ts. The edge runtime cannot import
// from src/, so the key literal and coerceLocale body are hand-copied here; both
// files assert the "org_language" literal in their tests so they cannot drift.

/** app_settings key holding an org's chosen language ("en" | "de"). */
export const ORG_LANGUAGE_SETTING_KEY = "org_language";

/** The languages server-generated content (emails, PDFs) can render in. */
export type ServerLocale = "en" | "de";

/** Narrow a stored/interpolated value to a ServerLocale; only exact "de" is German. */
export function coerceLocale(value: unknown): ServerLocale {
  return value === "de" ? "de" : "en";
}

/**
 * The language server-generated content should render in for an org. Returns
 * "de" ONLY when the org's `org_language` setting is "de" AND the org is entitled
 * to `language_packages` — the same double gate `AppLayout` enforces on the
 * client, so translated content can never leak to an org that has not been
 * granted the module. A null orgId (org-less auth or platform-scoped email) is
 * always "en". Short-circuits before any DB call when orgId is null, and skips
 * the entitlement RPC whenever the setting is not "de".
 */
export async function resolveOrgLocale(
  admin: SupabaseClient,
  orgId: string | null,
): Promise<ServerLocale> {
  if (!orgId) return "en";
  const lang = coerceLocale(
    await resolveOrgSetting(admin, orgId, ORG_LANGUAGE_SETTING_KEY, "en"),
  );
  if (lang !== "de") return "en";
  return (await checkFeature(admin, orgId, "language_packages")) ? "de" : "en";
}
