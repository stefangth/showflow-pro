// Where each /get-running task's setting actually LIVES in the product — the single typed
// map behind every "this step points to its real home" surface (question 1): the task
// panel's breadcrumb eyebrow + deep link, the board row's quiet route label, and the
// producer waits-on panel's Settings link (which used to keep its own separate list).
//
// The board retires once setup is complete, but these homes do not. Naming them on the
// board is what lets it TEACH the app instead of hiding it: a user reads "Rank your casts"
// and learns, in the same glance, that it lives in Settings › Casts & coverage.
//
// No React here — pure data + a link builder — so the composer's tests and the panel/row
// components can all read it without pulling in routing.

import { ROUTES } from "@/config/app.config";
import type { SettingsTabParam } from "@/lib/settingsTabs";
import type { GetRunningTaskKey } from "./tasks";

export interface TaskFeature {
  /** The route the setting's real home lives at. */
  route: string;
  /** When the home is a Settings section, the `?tab=` value. Every value here resolves as a
   *  deep link (see `SETTINGS_TAB_PARAMS` / `resolveInitialTab` in `src/lib/settingsTabs.ts`),
   *  including `hire-orders` for the contract tasks — that tab is entitlement-gated but the
   *  board only surfaces those tasks for an entitled org, and the tab is safe to open either
   *  way (it self-gates on `useFeature`). */
  tab?: SettingsTabParam;
  /** i18n key (`getRunning:feature.crumb.<key>`) for the full breadcrumb, e.g. "Settings ›
   *  Casts & coverage" — shown as the panel eyebrow. */
  crumbKey: string;
  /** i18n key (`getRunning:feature.short.<key>`) for the compact board-row label, e.g.
   *  "Casts & coverage" — the quiet route tag on each task row. */
  shortKey: string;
}

export const TASK_FEATURE: Record<GetRunningTaskKey, TaskFeature> = {
  dates: { route: ROUTES.BOOKINGS, crumbKey: "feature.crumb.dates", shortKey: "feature.short.dates" },
  slots: { route: ROUTES.PRODUCTIONS, crumbKey: "feature.crumb.slots", shortKey: "feature.short.slots" },
  flow: { route: ROUTES.SETTINGS, tab: "booking", crumbKey: "feature.crumb.flow", shortKey: "feature.short.flow" },
  people: { route: ROUTES.ARTISTS, crumbKey: "feature.crumb.people", shortKey: "feature.short.people" },
  ladder: { route: ROUTES.SETTINGS, tab: "casts-coverage", crumbKey: "feature.crumb.ladder", shortKey: "feature.short.ladder" },
  eligibility: { route: ROUTES.SETTINGS, tab: "casts-coverage", crumbKey: "feature.crumb.eligibility", shortKey: "feature.short.eligibility" },
  timing: { route: ROUTES.SETTINGS, tab: "booking", crumbKey: "feature.crumb.timing", shortKey: "feature.short.timing" },
  team: { route: ROUTES.SETTINGS, tab: "people", crumbKey: "feature.crumb.team", shortKey: "feature.short.team" },
  letterhead: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.letterhead", shortKey: "feature.short.letterhead" },
  terms: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.terms", shortKey: "feature.short.terms" },
  countersign: { route: ROUTES.SETTINGS, tab: "hire-orders", crumbKey: "feature.crumb.countersign", shortKey: "feature.short.countersign" },
};

/** The `to` target for a task's home, `?tab=` appended when the home is a Settings section. */
export function taskFeatureLink(key: GetRunningTaskKey): string {
  const feature = TASK_FEATURE[key];
  return feature.tab ? `${feature.route}?tab=${feature.tab}` : feature.route;
}
