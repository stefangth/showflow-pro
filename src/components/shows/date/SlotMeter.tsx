import { cn } from "@/lib/utils";
import type { DatePeekSeg } from "@/lib/bookingCockpit";

/** The single slot-meter colour map, private to <SlotMeter>. Both the cockpit
 *  header meter and the row-peek meter render through the component, so a tone
 *  change lives in one place. */
const SLOT_SEG_BG: Record<DatePeekSeg["tone"], string> = {
  confirmed: "bg-[var(--green-500)]",
  accepted: "bg-accent-400",
  open: "bg-[var(--surface-3)]",
};

/** A horizontal slot-fill meter: one bar per slot, coloured confirmed/accepted/open.
 *  Presentational; the tone array comes from `slotMeterTones` (or a DatePeek meter). */
export function SlotMeter({
  tones,
  className,
  testId,
  ariaLabel,
}: {
  tones: DatePeekSeg["tone"][];
  className?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn("flex gap-[3px]", className)} data-testid={testId} aria-label={ariaLabel}>
      {tones.map((t, i) => (
        <span key={i} className={cn("h-1.5 flex-1 rounded-[2px]", SLOT_SEG_BG[t])} />
      ))}
    </div>
  );
}
