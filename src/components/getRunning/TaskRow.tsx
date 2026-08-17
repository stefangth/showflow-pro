import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GetRunningTask, GetRunningTaskKey, TaskBlock } from "@/lib/getRunning/tasks";

/** Amber "Blocks …" chip keys, one per hard-ish block kind a `TaskRow` can actually see.
 *  `filling` never reaches this component: the only task carrying it (`slots`) lives in the
 *  `get_dates` phase, which `PhaseCard` renders as its own summary row, not via `TaskRow`. */
const BLOCK_CHIP_KEY: Record<Exclude<TaskBlock, null>, string> = {
  offers: "chips.blocksOffers",
  booking: "chips.blocksBooking",
  issuing: "chips.blocksIssuing",
  filling: "chips.blocksFilling",
};

/**
 * The right-side "value" chip half of the design's "a right-side value or button" — derived
 * ONLY from signals already true in `GetRunningTask` (`done`/`block`), never from settings
 * data `GetRunningModel` doesn't carry yet (e.g. timing's "19:00 · 48h" — deferred, not
 * fabricated). Currently the one case where `done` itself IS the value: a done `eligibility`
 * task means every scheduled show/city pair has coverage, which is exactly "All covered".
 * A `Record` keyed by every task key keeps this exhaustive and easy to extend later without
 * hunting for the right `if`. */
const VALUE_CHIP: Record<GetRunningTaskKey, { variant: BadgeProps["variant"]; labelKey: string } | null> = {
  dates: null,
  slots: null,
  flow: null,
  people: null,
  ladder: null,
  eligibility: { variant: "confirmed", labelKey: "chips.allCovered" },
  timing: null,
  team: null,
  letterhead: null,
  terms: null,
  countersign: null,
};

function valueChip(task: GetRunningTask): { variant: BadgeProps["variant"]; labelKey: string } | null {
  if (!task.done) return null;
  return VALUE_CHIP[task.key];
}

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
  onOpen: (key: GetRunningTaskKey) => void;
  /** Reserved for the producer-scoped board (Task 8): a producer viewing a task they can't
   *  act on gets a disabled/"View" affordance instead of the admin CTA. */
  viewerRole?: "admin" | "producer";
}

/**
 * One task row inside a `PhaseCard` (screen 01 board column): status dot, title, block/
 * admin-only chips, a derived value chip where the model already carries the value, a
 * one-line description, and a right-side action. The action is a filled primary button
 * only for a task that is both undone AND blocking (offers/booking/issuing); every other
 * row gets a lighter ghost affordance — a bordered button for an undone, non-blocking task,
 * or a plain text link ("Change") once the task is done. A task the viewer cannot act on
 * (`actionableByViewer === false`) never gets the primary treatment, even if it blocks —
 * and the done-task link is disabled/inert in that case too (not just the not-done button),
 * so a producer never gets a clickable affordance on a task they hold no capability for. The
 * producer-specific "Waits on {admin}" copy lands in Task 8.
 */
export function TaskRow({ task, onOpen }: TaskRowProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const isBlockingOpen = task.block !== null && !task.done && task.actionableByViewer;
  const value = valueChip(task);

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
      <div className="flex shrink-0 items-center gap-2">
        {value && <Badge variant={value.variant}>{t(value.labelKey)}</Badge>}
        {task.done ? (
          <button
            type="button"
            disabled={!task.actionableByViewer}
            className={`text-xs font-medium ${
              task.actionableByViewer ? "text-accent-600" : "cursor-not-allowed text-[var(--text-faint)]"
            }`}
            onClick={() => task.actionableByViewer && onOpen(task.key)}
          >
            {t(`tasks.${task.key}.action`)}
          </button>
        ) : (
          <Button
            type="button"
            variant={isBlockingOpen ? "default" : "outline"}
            size="sm"
            disabled={!task.actionableByViewer}
            onClick={() => onOpen(task.key)}
          >
            {t(`tasks.${task.key}.action`)}
          </Button>
        )}
      </div>
    </div>
  );
}
