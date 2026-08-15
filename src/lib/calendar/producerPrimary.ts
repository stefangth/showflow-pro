import type { ProducerActionKey, ProducerDateEntry } from './types';

export interface ProducerPrimaryResolution {
  /** The `ActionGates` key this resolution maps to — also what
   *  `CalendarSurface.handleRailPrimary` dispatches on. */
  kind: Extract<ProducerActionKey, 'confirmHolds' | 'generateHireOrder'>;
  label: string;
  /** The specific entry the action applies to (its `id` is what the
   *  dispatched callback is called with). */
  entry: ProducerDateEntry;
}

/**
 * Single source of truth for the producer primary-action priority rule
 * (spec §3.4): "Confirm holds" beats "Generate hire order" when a day has
 * both — accepted-but-unconfirmed slots are the more urgent, blocking
 * action. A `fully_filled` entry only offers Generate when it has no active
 * order yet (`hireOrderId == null`); an already-ordered date falls through
 * to `null` so the rail's secondary "Open date" action is the only one
 * offered. `null` = no primary action, so the caller may still force one via
 * `DayRail`'s `primaryLabel` prop.
 *
 * Both `DayRail`'s rendered label/gate lookup and
 * `CalendarSurface.handleRailPrimary`'s dispatch call this same function, so
 * the label, the gated action, and the fired action can never desync.
 */
export function resolveProducerPrimary(entries: ProducerDateEntry[]): ProducerPrimaryResolution | null {
  const withAccepted = entries.find(e => e.acceptedMain > 0);
  if (withAccepted) return { kind: 'confirmHolds', label: 'Confirm holds', entry: withAccepted };
  const filled = entries.find(e => e.status === 'fully_filled' && e.hireOrderId == null);
  if (filled) return { kind: 'generateHireOrder', label: 'Generate hire order', entry: filled };
  return null;
}
