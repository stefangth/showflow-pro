// src/lib/dashboard/setupBlocks.ts
import type { SetupBlock } from "./types";
import type { SetupStepBlock } from "@/components/setup/SetupStepRow";

/**
 * The one "Blocks X" chip vocabulary, shared by every setup rail.
 *
 * Both rails render the SAME step to the same viewer: the dashboard rail lists it in the
 * first-run checklist, the bookings rail lists it beside the table, and the setup sheet
 * opens one from the other. They used to hold a private copy of this map each, with
 * nothing tying them together and only one of the two typechecked against the union, so a
 * rename could land on one surface and not the other.
 *
 * Tones come from `badgeVariants`: `risk` (amber) is a hard blocker, `neutral` (muted) a
 * soft one. "offers" and "booking" are ONE hard gate seen under two flows (see `blockFor`
 * in src/lib/bookings/setupStatus.ts): an org that runs offers reads the specific
 * consequence, a direct-book org, which never opens a tier, reads the general one. They
 * therefore share a tone, or the direct-book org would read its blocker as the softer kind.
 */
export const SETUP_BLOCK_CHIPS: Record<Exclude<SetupBlock, null>, SetupStepBlock> = {
  offers: { label: "Blocks offers", tone: "risk" },
  booking: { label: "Blocks booking", tone: "risk" },
  filling: { label: "Blocks filling", tone: "neutral" },
  issuing: { label: "Blocks issuing", tone: "risk" },
};
