import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminDisplayName } from "@/data/orgAdmins";
import type { GetRunningTask, GetRunningTaskKey, TaskBlock } from "@/lib/getRunning/tasks";
import { TASK_FEATURE } from "@/lib/getRunning/taskFeature";

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

function StatusDot({ done, blockingOpen, active }: { done: boolean; blockingOpen: boolean; active: boolean }): JSX.Element {
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
        active ? "border-primary" : blockingOpen ? "border-accent-200" : "border-border"
      }`}
      aria-hidden="true"
    />
  );
}

export interface TaskRowProps {
  task: GetRunningTask;
  onOpen: (key: GetRunningTaskKey) => void;
  /** The active org's admin display names (from `useOrgAdminNames`, fetched once by the
   *  page and threaded down through `PhaseCard`), for the producer-scoped board (screen 03):
   *  a task `!actionableByViewer` names the admin it waits on instead of the generic
   *  "Admin only" chip. Omitted entirely for the admin board, where every task is
   *  actionable and this never renders. */
  adminNames?: string[];
  /** True when this task's panel is the one currently popped out beside the board. The row
   *  then reads as SELECTED (a `primary` violet tint plus a primary status dot + title), so
   *  the board makes clear which step the open editor belongs to. */
  active?: boolean;
}

/**
 * One task row inside a `PhaseCard` (screen 01/03 board column): status dot, title, block/
 * admin-only chips, a derived value chip where the model already carries the value, a
 * one-line description, and a right-side action. The action is a filled primary button
 * only for a task that is both undone AND blocking (offers/booking/issuing); every other
 * row gets a lighter ghost affordance — a bordered button for an undone, non-blocking task,
 * or a plain text link ("Change") once the task is done.
 *
 * A task the viewer cannot act on (`actionableByViewer === false`, always a producer on an
 * `adminOnly` task) never gets the primary/disabled treatment screen 01 uses for the admin:
 * per screen 03, it is NAMED and ATTRIBUTED instead — a grey "Waits on {admin}" chip
 * (`adminDisplayName` picks the first org admin name, falling back to a role-neutral "an
 * admin") replaces the generic "Admin only" chip, and a ghost "View" button (still enabled,
 * still opens the task panel — just never the primary/disabled control) replaces both the
 * not-done primary button and the done-task text link. Deliberately no "Nudge" control here:
 * the design's 3-channel nudge (in-app + email + chat) is a locked, confirmed-deferred scope
 * cut for this pass — only the attribution + view affordance ship.
 */
export function TaskRow({ task, onOpen, adminNames, active = false }: TaskRowProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const isBlockingOpen = task.block !== null && !task.done && task.actionableByViewer;
  const value = valueChip(task);
  const waitsOnAdmin = !task.actionableByViewer;
  const titleColor = active ? "text-primary" : task.done ? "text-muted-foreground" : "text-foreground";
  const titleWeight = active || task.done ? "font-medium" : "font-semibold";

  return (
    <div
      data-testid={`task-row-${task.key}`}
      data-active={active}
      className={`flex items-start gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 ${
        active ? "bg-primary/10" : ""
      }`}
    >
      <StatusDot done={task.done} blockingOpen={isBlockingOpen} active={active} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`text-sm ${titleWeight} ${titleColor}`}>
            {t(`tasks.${task.key}.title`)}
          </div>
          {task.block !== null && !task.done && (
            <Badge variant="risk">{t(BLOCK_CHIP_KEY[task.block])}</Badge>
          )}
          {waitsOnAdmin ? (
            <Badge variant="neutral">
              {t("chips.waitsOn", { name: adminDisplayName(adminNames, t("waitsOn.fallbackAdmin")) })}
            </Badge>
          ) : (
            task.adminOnly && <Badge variant="neutral">{t("chips.adminOnly")}</Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2 text-xs leading-[17px] text-muted-foreground">
          <span className="min-w-0 flex-1">{t(`tasks.${task.key}.description`)}</span>
          {/* Quiet route label: names where this step's setting really lives (question 1),
              so the board teaches the app even before a panel is opened. Hidden on the
              narrowest widths so it never crowds the description. */}
          <span className="hidden shrink-0 font-mono text-eyebrow text-[var(--text-faint)] sm:inline">
            {t(TASK_FEATURE[task.key].shortKey)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {value && <Badge variant={value.variant}>{t(value.labelKey)}</Badge>}
        {waitsOnAdmin ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onOpen(task.key)}>
            {t("actions.view")}
          </Button>
        ) : task.done ? (
          <button type="button" className="text-xs font-medium text-accent-600" onClick={() => onOpen(task.key)}>
            {t(`tasks.${task.key}.action`)}
          </button>
        ) : (
          <Button
            type="button"
            variant={isBlockingOpen ? "default" : "outline"}
            size="sm"
            onClick={() => onOpen(task.key)}
          >
            {t(`tasks.${task.key}.action`)}
          </Button>
        )}
      </div>
    </div>
  );
}
