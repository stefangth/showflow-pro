import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface StagedChange {
  label: string;
  transition: string;
  on: boolean;
}

interface StagedChangesCardProps {
  count: number;
  scopeLine: string;
  changes: StagedChange[];
  deltaSentence: string;
  canApply: boolean;
  onDiscard: () => void;
  onApply: () => void;
}

/** Right-rail card for the Roles & rights redesign: shows the staged
 *  (not-yet-applied) capability changes with a plain-language delta, and
 *  the Discard/Apply actions. Purely presentational. */
export function StagedChangesCard({
  count,
  scopeLine,
  changes,
  deltaSentence,
  canApply,
  onDiscard,
  onApply,
}: StagedChangesCardProps) {
  return (
    <div className="rounded-[var(--radius-l)] border border-border shadow-elev2 bg-card">
      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          STAGED CHANGES
        </p>
        <p className="mt-1 font-mono tabular-nums text-[22px] font-medium text-foreground">
          {count}
        </p>
        <p className="text-[12px] text-muted-foreground">{scopeLine}</p>
      </div>

      <div className="px-4 pt-3 pb-4">
        {count === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Nothing staged. Toggle a right and it lands here before anyone's
            access changes.
          </p>
        ) : (
          <>
            <div className="space-y-2.5">
              {changes.map((change) => (
                <div
                  key={change.label}
                  className="flex items-start gap-2.5"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-[6px] w-[6px] shrink-0 rounded-[var(--radius-xs)]",
                      change.on ? "bg-[var(--green-600)]" : "bg-[var(--red-600)]",
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">
                      {change.label}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {change.transition}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {deltaSentence && (
              <p className="mt-3 border-t border-[var(--line)] pt-3 text-[12px] text-muted-foreground">
                {deltaSentence}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3">
        <Button
          type="button"
          variant="outline"
          disabled={!canApply}
          onClick={onDiscard}
          className={cn(!canApply && "opacity-50")}
        >
          Discard
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={!canApply}
          onClick={onApply}
          className={cn("flex-1", !canApply && "opacity-50")}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
