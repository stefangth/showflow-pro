import { useTranslation } from "react-i18next";
import { Bell, Check, FileText, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedKind, FeedRow } from "@/lib/autopilot/today";

interface DoneForYouFeedProps {
  feed: FeedRow[];
  /** Weekday the feed's lookback window starts, e.g. "Friday". */
  sinceLabel: string;
  onAction: (row: FeedRow) => void;
}

const KIND_ICON: Record<FeedKind, LucideIcon> = {
  ask: Inbox,
  book: Check,
  draft: FileText,
  notify: Bell,
};

const KIND_TINT: Record<FeedKind, { bg: string; fg: string }> = {
  ask: { bg: "bg-accent-100", fg: "text-accent-700" },
  book: { bg: "bg-[var(--green-100)]", fg: "text-[var(--green-600)]" },
  draft: { bg: "bg-muted", fg: "text-muted-foreground" },
  notify: { bg: "bg-[var(--amber-100)]", fg: "text-[var(--amber-600)]" },
};

/**
 * "Done for you since {{day}}" feed (prototype lines 240-253). `row.text` is
 * already-formatted English coming straight from `fetchAutopilotFeed`
 * (src/data/autopilot.ts) via the pure `computeToday` — flagged as a known
 * gap in the Task 3 report (concern 3): it bypasses `t()` even in a German
 * session. Not fixed here — fixing it means changing the already-committed
 * data layer's `FeedInput.text` contract, out of this task's scope.
 */
export function DoneForYouFeed({ feed, sinceLabel, onAction }: DoneForYouFeedProps) {
  const { t } = useTranslation("today");

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5">
        <p className="m-0 flex-1 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          {t("feed.title", { day: sinceLabel })}
        </p>
        <span className="font-mono text-[11.5px] text-[var(--text-faint)]">{feed.length}</span>
      </div>
      {feed.map((row) => {
        const Icon = KIND_ICON[row.kind];
        const tint = KIND_TINT[row.kind];
        return (
          <div
            key={row.id}
            className="flex items-center gap-3.5 border-b border-border px-[18px] py-3 last:border-b-0"
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                tint.bg,
                tint.fg,
              )}
            >
              <Icon className="h-[11px] w-[11px]" />
            </span>
            <p className="m-0 flex-1 text-[13px] leading-[19px]">{row.text}</p>
            <span className="shrink-0 font-mono text-[11.5px] text-[var(--text-faint)]">{row.at}</span>
            <button
              type="button"
              onClick={() => onAction(row)}
              className="shrink-0 border-0 bg-transparent p-0 text-[12.5px] font-medium text-accent-text"
            >
              {row.affordance === "undo" ? t("feed.undo") : t("feed.review")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
