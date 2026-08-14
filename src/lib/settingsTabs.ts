// Deep-linking into a Settings section: `/settings?tab=<value>`.
//
// The values are the SettingsPage <TabsTrigger value> strings. Every one of them is a
// deep-link target except "hire-orders", which is entitlement-gated: this pure helper
// cannot see the org's entitlement, so honouring it would strand an unentitled org on an
// empty pane. Admin-only "permissions" IS listed, but gated below on the caller's role, and
// "docs" (Documentation) is likewise listed but gated below to super-admins only — it is no
// longer a reachable deep-link target for an admin or producer. The concept explainers that
// used to deep-link here now point at the Help center instead (see ROUTES.HELP).
//
// For callers building a link: SettingsPage follows the param whether or not it is already
// mounted (it seeds from this helper and re-runs on a change of `?tab=`), so an in-app
// notification or menu item may link to `/settings?tab=airtable` from anywhere, including
// from Settings itself. The page does not rewrite the URL when the user then switches tabs
// by hand, so the param is a starting point, not a lock.

/** Every `?tab=` value the page is willing to open. */
export const SETTINGS_TAB_PARAMS = [
  "organization",
  "permissions",
  "casts-coverage",
  "skills",
  "airtable",
  "booking",
  "email-templates",
  "filters",
  "notifications",
  "docs",
] as const;

export type SettingsTabParam = typeof SETTINGS_TAB_PARAMS[number];

/** Tabs whose trigger and content only render for an admin. */
const ADMIN_ONLY: readonly SettingsTabParam[] = ["permissions"];

/** Tabs whose trigger and content only render for a super-admin. */
const SUPER_ADMIN_ONLY: readonly SettingsTabParam[] = ["docs"];

/**
 * Retired `?tab=` values mapped to their replacement, so a link or bookmark from before
 * the Casts & coverage / Skills redesign still lands somewhere valid instead of falling
 * back to the role default. Both legacy sections folded into "casts-coverage".
 */
const LEGACY_TAB_REDIRECTS: Readonly<Record<string, SettingsTabParam>> = {
  "casts-cities": "casts-coverage",
  "production-ownership": "casts-coverage",
};

/** Where the page lands with no (or an unusable) `?tab=`, matching what it did before
 *  deep-linking existed. */
export function defaultSettingsTab(_isAdmin: boolean): SettingsTabParam {
  return "organization";
}

/**
 * The tab SettingsPage should open on, from the raw `?tab=` search param.
 *
 * Anything unrecognised, any admin-only tab asked for by a non-admin, and any super-admin-only
 * tab asked for by a non-super-admin, falls back to the role default rather than selecting a
 * tab with no trigger and no content.
 */
export function resolveInitialTab(
  param: string | null,
  isAdmin: boolean,
  isSuperAdmin: boolean = false,
): SettingsTabParam {
  const fallback = defaultSettingsTab(isAdmin);
  if (!param) return fallback;
  const redirected = LEGACY_TAB_REDIRECTS[param];
  const match = redirected ?? SETTINGS_TAB_PARAMS.find((t) => t === param);
  if (!match) return fallback;
  if (!isAdmin && ADMIN_ONLY.includes(match)) return fallback;
  if (!isSuperAdmin && SUPER_ADMIN_ONLY.includes(match)) return fallback;
  return match;
}
