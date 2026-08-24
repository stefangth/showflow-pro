import { useTranslation } from "react-i18next";
import { Bell, Check, FileText, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";
import { canUndoFeedRow, type FeedKind, type FeedRow } from "@/lib/autopilot/today";
import { feedRowText } from "./feedRowText";

interface DoneForYouFeedProps {
  feed: FeedRow[];
  /** `TodayModel.producerConfirmation` — a yes is only a hold until a producer
   *  books it, so the row must not claim a booking. */
  producerConfirmation: boolean;
  /** This viewer's `confirm_bookings` right. Decides both whether a said-yes row
   *  is addressed to them and whether its Undo (which cancels bookings) is theirs
   *  to press. */
  canBook: boolean;
  /** This viewer's `run_offer_engine` right. Undoing an "ask" row withdraws
   *  offers, which is the same right the ask itself needed. */
  canAsk: boolean;
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
  ask: { bg: "bg-accent-tint", fg: "text-accent-text" },
  book: { bg: "bg-[var(--green-100)]", fg: "text-[var(--green-600)]" },
  draft: { bg: "bg-well-tint", fg: "text-muted-foreground" },
  notify: { bg: "bg-[var(--amber-100)]", fg: "text-[var(--amber-600)]" },
};

/**
 * "Done for you since {{day}}" feed (prototype lines 240-253). Each row's
 * text is rendered through `feedRowText` above, from the structured values
 * `fetchAutopilotFeed` (src/data/autopilot.ts) returns via the pure
 * `computeToday` — fully localized, not baked English (finding 6).
 */
export function DoneForYouFeed({
  feed,
  producerConfirmation,
  canBook,
  canAsk,
  sinceLabel,
  onAction,
}: DoneForYouFeedProps) {
  const { t } = useTranslation("today");

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5">
        <Eyebrow className="flex-1">
          {t("feed.title", { day: sinceLabel })}
        </Eyebrow>
        <span className="text-caption tabular-nums text-[var(--text-faint)]">{feed.length}</span>
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
            <p className="m-0 flex-1 text-control leading-[19px]">{feedRowText(t, row, { producerConfirmation, canBook })}</p>
            <span className="shrink-0 text-caption tabular-nums text-[var(--text-faint)]">{row.at}</span>
            <button
              type="button"
              onClick={() => onAction(row)}
              className="shrink-0 border-0 bg-transparent p-0 text-control font-medium text-accent-text"
            >
              {row.affordance === "undo" && canUndoFeedRow(row.kind, { canBook, canAsk })
                ? t("feed.undo")
                : t("feed.review")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
