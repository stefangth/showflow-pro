// Deep-linking into a Settings section: `/settings?tab=<value>`.
//
// The values are the SettingsPage <TabsTrigger value> strings. Every one of them is a
// deep-link target except "hire-orders", which is entitlement-gated: this pure helper
// cannot see the org's entitlement, so honouring it would strand an unentitled org on an
// empty pane. Admin-only "permissions" IS listed, but gated below on the caller's role.
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
  "production-ownership",
  "casts-cities",
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

/** Where the page lands with no (or an unusable) `?tab=`, matching what it did before
 *  deep-linking existed. */
export function defaultSettingsTab(_isAdmin: boolean): SettingsTabParam {
  return "organization";
}

/**
 * The tab SettingsPage should open on, from the raw `?tab=` search param.
 *
 * Anything unrecognised, and any admin-only tab asked for by a non-admin, falls back to
 * the role default rather than selecting a tab with no trigger and no content.
 */
export function resolveInitialTab(param: string | null, isAdmin: boolean): SettingsTabParam {
  const fallback = defaultSettingsTab(isAdmin);
  if (!param) return fallback;
  const match = SETTINGS_TAB_PARAMS.find((t) => t === param);
  if (!match) return fallback;
  if (!isAdmin && ADMIN_ONLY.includes(match)) return fallback;
  return match;
}
