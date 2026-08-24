// Which i18n keys title a step's body in the v3 wizard.
//
// The step title lives on `WizardShell`, not on the eight v3-owned step bodies, so that
// the eight bodies reused from v1 and the setup rails get titled too. Three steps read
// differently depending on the org's dates source, and the shell cannot see that source,
// so the choice is made here and passed down.
//
// No React here, only key strings, so the composer's tests can read it without routing.

import type { DatesSource } from "@/data/datesSource";
import type { GetRunningStepKey } from "./steps";

/** The steps whose copy is written per dates source. */
const SOURCE_AWARE: ReadonlySet<GetRunningStepKey> = new Set(["connect", "map", "cities"]);

export interface StepHeadingKeys {
  headingKey: string;
  subKey: string;
  /** The guide's bullet list. `cities` carries an extra Airtable-only bullet ("new dates
   *  synced from Airtable inherit their city"), which is a promise a manual or sheet org
   *  will never see kept. */
  pointsKey: string;
}

/**
 * The heading/sub keys for one step.
 *
 * A `sheet` org gets the sheet-flavoured copy for the three source-aware steps. An org
 * that has not picked a source yet gets `connect`'s "pick a source first" copy rather
 * than the Airtable-flavoured default, which used to title the step "Connect Airtable"
 * over a body that said "By hand needs no connection".
 */
export function stepHeadingKeys(key: GetRunningStepKey, source: DatesSource): StepHeadingKeys {
  const pointsKey =
    key === "cities" && source === "airtable" ? "guide.cities.pointsAirtable" : `guide.${key}.points`;
  if (key === "connect" && source == null) {
    return { headingKey: "body.connect.none.heading", subKey: "body.connect.none.sub", pointsKey };
  }
  if (SOURCE_AWARE.has(key) && source === "sheet") {
    return { headingKey: `body.${key}.sheet.heading`, subKey: `body.${key}.sheet.sub`, pointsKey };
  }
  return { headingKey: `body.${key}.heading`, subKey: `body.${key}.sub`, pointsKey };
}
