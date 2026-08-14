import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RightGroupCardProps {
  group: string;
  summary: string;
  allOn: boolean;
  onToggleAll: () => void;
  children: ReactNode;
}

/** Card grouping the `RightRow`s for one capability group, with a header
 *  showing the group title, an "N of M on" summary, and a bulk toggle link. */
export function RightGroupCard({
  group,
  summary,
  allOn,
  onToggleAll,
  children,
}: RightGroupCardProps) {
  return (
    <div className="rounded-[var(--radius-l)] border border-border shadow-elev2 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--line)]">
        <p className="text-sm font-medium text-foreground">{group}</p>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[12px] text-muted-foreground">
            {summary}
          </span>
          <button
            type="button"
            onClick={onToggleAll}
            className={cn(
              "text-[12px] font-medium text-accent-700 hover:underline",
            )}
          >
            {allOn ? "Turn all off" : "Turn all on"}
          </button>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
