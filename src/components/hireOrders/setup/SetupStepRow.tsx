import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface SetupStepRowProps {
  /** 1-based position, shown while the step is outstanding. */
  index: number;
  title: string;
  hint: string;
  done: boolean;
  blocksIssue: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

/** One row of the setup rail: a tick or a number, the title, a one-line hint, and a
 *  "Blocks issue" chip only where leaving the step undone actually fails the issue
 *  action. A checklist that overstates its blockers stops being believed. */
export function SetupStepRow({
  index, title, hint, done, blocksIssue, expanded, onToggle, children,
}: SetupStepRowProps) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
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
        {!done && blocksIssue && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600">
            Blocks issue
          </span>
        )}
      </button>
      {expanded && <div className="border-t border-border bg-muted/40 p-3">{children}</div>}
    </div>
  );
}
