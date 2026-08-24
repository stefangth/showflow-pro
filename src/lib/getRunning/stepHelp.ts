// Where a step's "Read more" actually reads.
//
// Deliberately separate from `stepFeature.ts`, which says where the SETTING LIVES. A step
// points at both, and conflating them is what sent "Read more about the Airtable
// connection" to /dates: the place you go to do the thing, not the place that explains it.
//
// `item` deep links one help answer (`/help?item=<id>`, expanded and scrolled to).
// `q` prefills the help search instead, for a step whose topic has no single answer of
// its own. `stepHelp.test.ts` pins every `item` against the real HELP_ITEMS ids, so a
// renamed or deleted answer fails the build rather than silently opening nothing.

import { ROUTES } from "@/config/app.config";
import type { GetRunningStepKey } from "./steps";

export type StepHelpTarget = { item: string } | { q: string };

export const STEP_HELP: Record<GetRunningStepKey, StepHelpTarget> = {
  source: { item: "A3.8" }, // Can I import dates from a Google Sheet instead of Airtable?
  connect: { item: "A4.2" }, // Did the Airtable sync work? Why are dates missing?
  map: { item: "A3.13" }, // Which Airtable columns do I have to map?
  cities: { item: "A3.11" }, // A date has no city. Where do I fix that?
  productions: { item: "A3.10" }, // How do I require a skill that does not exist yet?
  artists: { item: "A3.2" }, // How do my people get in? How do artists get accounts?
  skills: { item: "A3.10" }, // Same casting-breakdown answer, from the skills side.
  coverage: { item: "A3.1" }, // What are casts, and who gets asked first?
  flow: { item: "A3.5" }, // Which booking flow should I pick?
  timing: { item: "A3.3" }, // What happens tonight, once I finish setup?
  team: { item: "A4.3" }, // How do I change someone's role or remove them?
  letterhead: { item: "A3.14" },
  fee: { item: "A3.9" }, // Can I set a different fee for one cast on one production?
  terms: { item: "A3.15" },
  document: { item: "A3.16" },
  countersign: { item: "A3.17" },
};

/** The `to` target for a step's "Read more" link. Always inside the help center. */
export function stepHelpLink(key: GetRunningStepKey): string {
  const entry = STEP_HELP[key];
  const param = "item" in entry ? `item=${encodeURIComponent(entry.item)}` : `q=${encodeURIComponent(entry.q)}`;
  return `${ROUTES.HELP}?${param}`;
}
