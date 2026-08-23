// Where each /get-running step's setting actually LIVES in the product — the single typed
// map behind every "this step points to its real home" surface (question 1): the step
// panel's breadcrumb eyebrow + deep link, the board row's quiet route label, and the
// producer waits-on panel's Settings link.
//
// This mirrors v1's taskFeature.ts idiom but targets the 16-step Wireflow v3 model.
// No React here — pure data + a link builder — so the composer's tests and the panel/row
// components can all read it without pulling in routing.

import { ROUTES } from "@/config/app.config";
import type { SettingsTabParam } from "@/lib/settingsTabs";
import type { GetRunningStepKey } from "./steps";

export interface StepFeature {
  /** The route the setting's real home lives at. */
  route: string;
  /** When the home is a Settings section, the `?tab=` value. Every value here resolves as a
   *  deep link (see `SETTINGS_TAB_PARAMS` / `resolveInitialTab` in `src/lib/settingsTabs.ts`),
   *  including `hire-orders` for the contract steps — that tab is entitlement-gated but the
   *  board only surfaces those steps for an entitled org, and the tab is safe to open either
   *  way (it self-gates on `useFeature`). */
  tab?: SettingsTabParam;
  /** i18n key (`getRunning:feature.crumb.<key>`) for the full breadcrumb, e.g. "Settings ›
   *  Hire Orders" — shown as the panel eyebrow. */
  crumbKey: string;
  /** i18n key (`getRunning:feature.short.<key>`) for the compact board-row label, e.g.
   *  "Hire Orders" — the quiet route tag on each step row. */
  shortKey: string;
}

export const STEP_FEATURE: Record<GetRunningStepKey, StepFeature> = {
  source: { route: ROUTES.BOOKINGS, crumbKey: "feature.crumb.source", shortKey: "feature.short.source" },
  connect: { route: ROUTES.BOOKINGS, crumbKey: "feature.crumb.connect", shortKey: "feature.short.connect" },
  map: { route: ROUTES.BOOKINGS, crumbKey: "feature.crumb.map", shortKey: "feature.short.map" },
  cities: { route: ROUTES.BOOKINGS, crumbKey: "feature.crumb.cities", shortKey: "feature.short.cities" },
  productions: { route: ROUTES.PRODUCTIONS, crumbKey: "feature.crumb.productions", shortKey: "feature.short.productions" },
  artists: { route: ROUTES.ARTISTS, crumbKey: "feature.crumb.artists", shortKey: "feature.short.artists" },
  skills: { route: ROUTES.SETTINGS, tab: "skills", crumbKey: "feature.crumb.skills", shortKey: "feature.short.skills" },
  coverage: { route: ROUTES.SETTINGS, tab: "casts-coverage", crumbKey: "feature.crumb.coverage", shortKey: "feature.short.coverage" },
  flow: { route: ROUTES.SETTINGS, tab: "booking", crumbKey: "feature.crumb.flow", shortKey: "feature.short.flow" },
  timing: { route: ROUTES.SETTINGS, tab: "booking", crumbKey: "feature.crumb.timing", shortKey: "feature.short.timing" },
  team: { route: ROUTES.SETTINGS, tab: "people", crumbKey: "feature.crumb.team", shortKey: "feature.short.team" },
  letterhead: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.letterhead", shortKey: "feature.short.letterhead" },
  fee: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.fee", shortKey: "feature.short.fee" },
  terms: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.terms", shortKey: "feature.short.terms" },
  document: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.document", shortKey: "feature.short.document" },
  countersign: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.countersign", shortKey: "feature.short.countersign" },
};

/** The `to` target for a step's home, `?tab=` appended when the home is a Settings section. */
export function stepFeatureLink(key: GetRunningStepKey): string {
  const feature = STEP_FEATURE[key];
  return feature.tab ? `${feature.route}?tab=${feature.tab}` : feature.route;
}

const STEP_KEYS = Object.keys(STEP_FEATURE) as GetRunningStepKey[];

/** Every step whose home is this route (+ optional settings tab), in board order.
 *  STEP_FEATURE is forward-only and non-injective (e.g. /dates owns 4 steps), so a
 *  page resolves its "finish setup" target by picking the first not-done step here. */
export function stepsForRoute(route: string, tab?: SettingsTabParam): GetRunningStepKey[] {
  return STEP_KEYS.filter((k) => {
    const f = STEP_FEATURE[k];
    return f.route === route && (tab === undefined || f.tab === tab);
  });
}

/** The paperwork phase's steps. Exported because /contracts (ROUTES.HIRE_ORDERS)
 *  is not the STEP_FEATURE home of any step — the setup steps live at
 *  /settings?tab=hire-orders — so the contracts page targets the phase directly. */
export const PAPERWORK_STEP_KEYS: GetRunningStepKey[] = ["letterhead", "fee", "terms", "document", "countersign"];
