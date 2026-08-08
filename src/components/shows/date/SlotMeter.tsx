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
  fixed = false,
}: {
  tones: DatePeekSeg["tone"][];
  className?: string;
  testId?: string;
  ariaLabel?: string;
  /** Fixed 16px-wide segments (the cockpit header meter) instead of stretching
   *  each segment to fill (the row-peek meter). */
  fixed?: boolean;
}) {
  return (
    <div
      className={cn("flex gap-[3px]", fixed ? "shrink-0" : "", className)}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {tones.map((t, i) => (
        <span key={i} className={cn("h-1.5 rounded-[2px]", fixed ? "w-4" : "flex-1", SLOT_SEG_BG[t])} />
      ))}
    </div>
  );
}
