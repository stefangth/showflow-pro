import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GetRunningTask, TaskBlock } from "@/lib/getRunning/tasks";

/** Amber "Blocks …" chip keys, one per hard-ish block kind a `TaskRow` can actually see.
 *  `filling` never reaches this component: the only task carrying it (`slots`) lives in the
 *  `get_dates` phase, which `PhaseCard` renders as its own summary row, not via `TaskRow`. */
const BLOCK_CHIP_KEY: Record<Exclude<TaskBlock, null>, string> = {
  offers: "chips.blocksOffers",
  booking: "chips.blocksBooking",
  issuing: "chips.blocksIssuing",
  filling: "chips.blocksFilling",
};

function StatusDot({ done, blockingOpen }: { done: boolean; blockingOpen: boolean }): JSX.Element {
  if (done) {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] ${
        blockingOpen ? "border-accent-200" : "border-border"
      }`}
      aria-hidden="true"
    />
  );
}

export interface TaskRowProps {
  task: GetRunningTask;
  onOpen: (key: GetRunningTask["key"]) => void;
  /** Reserved for the producer-scoped board (Task 8): a producer viewing a task they can't
   *  act on gets a disabled/"View" affordance instead of the admin CTA. */
  viewerRole?: "admin" | "producer";
}

/**
 * One task row inside a `PhaseCard` (screen 01 board column): status dot, title, block/
 * admin-only chips, one-line description, and a right-side action. The action is a filled
 * primary button only for a task that is both undone AND blocking (offers/booking/issuing);
 * every other row gets a lighter ghost affordance — a bordered button for an undone,
 * non-blocking task, or a plain text link ("Change") once the task is done. A task the
 * viewer cannot act on (`actionableByViewer === false`) never gets the primary treatment,
 * even if it blocks — the producer-specific "Waits on {admin}" copy lands in Task 8.
 */
export function TaskRow({ task, onOpen }: TaskRowProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const isBlockingOpen = task.block !== null && !task.done && task.actionableByViewer;

  return (
    <div
      data-testid={`task-row-${task.key}`}
      className="flex items-start gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
    >
      <StatusDot done={task.done} blockingOpen={isBlockingOpen} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`text-sm ${task.done ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}>
            {t(`tasks.${task.key}.title`)}
          </div>
          {task.block !== null && !task.done && (
            <Badge variant="risk">{t(BLOCK_CHIP_KEY[task.block])}</Badge>
          )}
          {task.adminOnly && <Badge variant="neutral">{t("chips.adminOnly")}</Badge>}
        </div>
        <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground">{t(`tasks.${task.key}.description`)}</div>
      </div>
      {task.done ? (
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-accent-600"
          onClick={() => onOpen(task.key)}
        >
          {t(`tasks.${task.key}.action`)}
        </button>
      ) : (
        <Button
          type="button"
          variant={isBlockingOpen ? "default" : "outline"}
          size="sm"
          disabled={!task.actionableByViewer}
          className="shrink-0"
          onClick={() => onOpen(task.key)}
        >
          {t(`tasks.${task.key}.action`)}
        </Button>
      )}
    </div>
  );
}
