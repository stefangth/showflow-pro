// Deep-linking into a Settings section: `/settings?tab=<value>`.
//
// The values are the SettingsPage <TabsTrigger value> strings, and every one is a deep-link
// target. "hire-orders" is entitlement-gated (this pure helper cannot see the org's
// entitlement) but is still a safe deep-link target: SettingsPage renders its trigger and
// content for any admin/producer regardless of entitlement (with a module-off indicator),
// so a `?tab=hire-orders` link is no worse than the tab an admin can already click by hand,
// and HireOrdersTab self-gates on `useFeature`. Admin-only "permissions" IS listed, but gated below on the caller's role, and
// "docs" (Documentation) is likewise listed but gated below to super-admins only — it is no
// longer a reachable deep-link target for an admin or producer. The concept explainers that
// used to deep-link here now point at the Help center instead (see ROUTES.HELP). "people"
// and "activity" are the former standalone Admin page's tabs, folded in as an admin-only
// group; `/admin` now redirects straight to `?tab=people`. Its former "sync-log" tab was
// retired (duplicate of the Airtable sync tab's own history view) rather than folded in.
//
// For callers building a link: SettingsPage follows the param whether or not it is already
// mounted (it seeds from this helper and re-runs on a change of `?tab=`), so an in-app
// notification or menu item may link to `/settings?tab=airtable` from anywhere, including
// from Settings itself. The page does not rewrite the URL when the user then switches tabs
// by hand, so the param is a starting point, not a lock.

/** Every `?tab=` value the page is willing to open. */
export const SETTINGS_TAB_PARAMS = [
  "organization",
  "how-it-works",
  "permissions",
  "people",
  "activity",
  "casts-coverage",
  "skills",
  "airtable",
  "booking",
  "hire-orders",
  "email-templates",
  "notifications",
  "docs",
] as const;

export type SettingsTabParam = typeof SETTINGS_TAB_PARAMS[number];

/** Tabs whose trigger and content only render for an admin. */
const ADMIN_ONLY: readonly SettingsTabParam[] = ["permissions", "people", "activity"];

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

/** Where the page lands with no (or an unusable) `?tab=`.
 *
 *  "How this org works" is the intended landing screen. Today it is also the only branch that
 *  runs in practice: ROUTES.SETTINGS is guarded to `['admin','producer']` in App.tsx, so every
 *  caller that reaches SettingsPage satisfies `isAdmin || isProducer`. The "organization" branch
 *  is a defensive fallback for a hypothetically role-less caller (e.g. if that route guard is
 *  ever loosened). Note it is NOT a safe universal fallback: "organization" is itself gated
 *  `show: isAdmin || isProducer` in SettingsPage `navGroups`, so such a caller would have no
 *  visible Settings tab at all — this fallback (and the guard) would need revisiting together. */
export function defaultSettingsTab(isAdmin: boolean, isProducer: boolean = false): SettingsTabParam {
  return isAdmin || isProducer ? "how-it-works" : "organization";
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
  isProducer: boolean = false,
): SettingsTabParam {
  const fallback = defaultSettingsTab(isAdmin, isProducer);
  if (!param) return fallback;
  const redirected = LEGACY_TAB_REDIRECTS[param];
  const match = redirected ?? SETTINGS_TAB_PARAMS.find((t) => t === param);
  if (!match) return fallback;
  if (!isAdmin && ADMIN_ONLY.includes(match)) return fallback;
  if (!isSuperAdmin && SUPER_ADMIN_ONLY.includes(match)) return fallback;
  return match;
}
