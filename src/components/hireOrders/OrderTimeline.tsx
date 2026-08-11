import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestampDMY } from "@/lib/dates";

interface Props {
  status: string;
  createdAt?: string | null;
  issuedAt?: string | null;
  /** When the linked artist first opened this order in the app (`hire_orders.viewed_at`).
   *  Drives the "Seen" step below — absent for a not-yet-opened order. */
  seenAt?: string | null;
  countersignedAt?: string | null;
}

/** The five lifecycle milestones, in order. */
const STEPS = ["Created", "Issued to artist", "Seen", "Awaiting countersign", "Countersigned"] as const;

/**
 * Index of the currently-active (amber) step for a given status. Steps before
 * it read as done, steps after as upcoming. "Seen" (index 2) is deliberately
 * excluded from this progression — see the `seenAt` gate in the render loop
 * below, where it is reached independently of `active`.
 *   draft / ready / void  -> Created is the live milestone
 *   issued                -> Awaiting countersign is live (issued step is done)
 *   countersigned         -> Countersigned reached (terminal)
 */
function activeStepIndex(status: string): number {
  switch (status) {
    case "issued":
      return 3;
    case "countersigned":
      return 4;
    default:
      return 0;
  }
}

/** A per-step timestamp shown beneath the label, when available. */
function stepTimestamp(
  index: number,
  { createdAt, issuedAt, seenAt, countersignedAt }: Omit<Props, "status">,
): string | null {
  const raw =
    index === 0 ? createdAt :
    index === 1 ? issuedAt :
    index === 2 ? seenAt :
    index === 4 ? countersignedAt :
    null;
  return raw ? formatTimestampDMY(raw) : null;
}

/**
 * Vertical five-step status timeline for a hire order. The active step is amber
 * (per the V3 design), completed steps show a check, upcoming steps are muted.
 *
 * "Seen" is the one step whose reached state does NOT follow from `index <
 * active`: an issued order sits at "Awaiting countersign" (active) whether or
 * not the artist has opened it, so Seen's own checkmark is gated on `seenAt`
 * being present, not on its position ahead of the active step.
 */
export function OrderTimeline({ status, createdAt, issuedAt, seenAt, countersignedAt }: Props) {
  const active = activeStepIndex(status);
  return (
    <ol className="space-y-0" aria-label="Order status timeline">
      {STEPS.map((label, i) => {
        const done = i === 2 ? seenAt != null : i < active;
        const isActive = i === active;
        const last = i === STEPS.length - 1;
        const ts = stepTimestamp(i, { createdAt, issuedAt, seenAt, countersignedAt });
        return (
          <li key={label} className="flex gap-3">
            {/* Dot + connector rail */}
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  done && "border-transparent bg-[var(--green-600)] text-white",
                  isActive && "border-transparent bg-[var(--amber-500)] text-white",
                  !done && !isActive && "border-border bg-muted text-transparent",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn("w-px flex-1 min-h-6", done ? "bg-[var(--green-600)]" : "bg-border")}
                />
              )}
            </div>
            {/* Label + timestamp */}
            <div className={cn("pb-4", last && "pb-0")}>
              <p
                className={cn(
                  "text-sm leading-5",
                  isActive ? "font-medium text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </p>
              {ts && <p className="text-xs font-mono text-muted-foreground">{ts}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
