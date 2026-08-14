import { CAPABILITY_DEFS } from "../capabilities";

export type Preset = "Restricted" | "Standard" | "Full" | "Custom";

// Restricted = the safe day-to-day set: standard-risk, non-sensitive core ops.
const RESTRICTED = new Set([
  "producer_can_invite",
  "producer_can_manage_productions",
  "producer_can_manage_show_dates",
  "producer_can_edit_artists",
  "producer_can_confirm_bookings",
  "producer_can_run_offer_engine",
]);

export function presetOnKeys(preset: Preset): Set<string> {
  if (preset === "Full") return new Set(CAPABILITY_DEFS.map(d => d.key));
  if (preset === "Restricted") return new Set(RESTRICTED);
  // Standard (and any unknown) => registry defaults
  return new Set(CAPABILITY_DEFS.filter(d => d.defaultEnabled).map(d => d.key));
}

// Checks only the keys present in `effective` -- callers scope this to whichever
// rows are actually visible/editable, so a key the caller omits (e.g. a row hidden
// because its module is off) never blocks a preset from reading as active.
export function matchesPreset(effective: Record<string, boolean>, preset: Preset): boolean {
  if (preset === "Custom") return false;
  if (Object.keys(effective).length === 0) return false;
  const on = presetOnKeys(preset);
  return Object.keys(effective).every(key => (effective[key] ?? false) === on.has(key));
}
