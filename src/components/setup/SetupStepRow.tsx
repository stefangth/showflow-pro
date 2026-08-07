import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SetupStepBlock {
  label: string;
  /** `risk` = amber "hard" blocker; `neutral` = muted "soft" blocker. */
  tone: "risk" | "neutral";
}

export interface SetupStepRowProps {
  /** 1-based position, shown while the step is outstanding. */
  index: number;
  title: string;
  hint: string;
  done: boolean;
  block: SetupStepBlock | null;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

/** One row of a setup rail: a tick or a number, the title, a one-line hint, and an
 *  optional chip carried by the caller. A checklist that overstates its blockers stops
 *  being believed, so `block` is null on steps that do not block anything. */
export function SetupStepRow({
  index, title, hint, done, block, expanded, onToggle, children,
}: SetupStepRowProps) {
  const panelId = useId();
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-muted/50"
      >
        {done ? (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </span>
        ) : (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
            {index}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs leading-[17px] text-muted-foreground">{hint}</span>
        </span>
        {/* A span, not <Badge>, because this sits inside a button and a div there is
            invalid markup. The tone rides the Badge cva so amber stays on the --amber-*
            vars (dark-mode override) rather than Tailwind's built-in amber. */}
        {!done && block && (
          <span className={cn(badgeVariants({ variant: block.tone }), "shrink-0 font-semibold")}>
            {block.label}
          </span>
        )}
      </button>
      {expanded && <div id={panelId} className="border-t border-border bg-muted/40 p-3">{children}</div>}
    </div>
  );
}
