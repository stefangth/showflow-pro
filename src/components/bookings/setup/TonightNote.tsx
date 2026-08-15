import { useTranslation } from "react-i18next";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { describeTonightStandalone } from "@/lib/bookings/timingCopy";

/**
 * The rail's one-line answer to "so what happens when I finish?", read from the org's
 * saved flow and hours.
 *
 * It exists because the sentence it prints lives inside `TimingStep`, the sixth row, and
 * every row on this rail is collapsed unless opened: the rail seeds `flow` and FlowStep
 * hands over to `people`, so an admin can configure the whole pipeline and never read what
 * it will do. `TimingStep` still owns the sentence while its panel is open, where it
 * updates from the live inputs; the rail renders this only while that panel is closed.
 *
 * A component rather than two hooks in `BookingSetupRail`, because the rail returns the
 * producer waiting card before it reaches the footer: mounting the reads here is what makes
 * "a non-editor is not billed for this" true of the queries and not just of the pixels.
 *
 * Not a second copy of `RehearsalBlock`'s footer, which states the same hours further down.
 * That line resolves ONE date, appears only after the admin runs the dry run, and never
 * renders for a direct-book org at all; this is the standing rule, printed unprompted, and
 * for a direct-book org with the confirmation digest on it is the only line on the rail
 * that says when anything is sent. Both read `hh` and the same `useFlowTimes` values, so
 * neither can state an hour the other contradicts.
 *
 * `orgId ? flowQ.data : null` is the same narrowing every flow-aware panel on this rail
 * carries: `useBookingFlow` has no `enabled` gate, so a null org still resolves the
 * PLATFORM DEFAULT settings row into a truthy, offers-shaped flow belonging to no org.
 * `describeTonightStandalone` would then narrate a digest pipeline for an org this surface
 * has not identified.
 */
export function TonightNote({ orgId }: { orgId: string | null }) {
  const { t: tBooking } = useTranslation("bookingCopy");
  const flowQ = useBookingFlow(orgId);
  const flow = orgId ? flowQ.data : null;
  const { data: times } = useFlowTimes(orgId);
  // No hours, no schedule to state: `useFlowTimes` is gated on the org and holds no data
  // while the read is in flight or after it fails. The code defaults are deliberately not
  // substituted here, for the same reason TimingStep withholds its inputs until the read
  // lands: 19:00 and 20:00 are not this org's hours until the org says so.
  if (!times) return null;
  const line = describeTonightStandalone(times, flow, tBooking);
  if (!line) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <p className="text-xs font-medium text-foreground">What the engine will do</p>
      <p className="mt-0.5 text-xs leading-[17px] text-muted-foreground">{line}</p>
    </div>
  );
}
