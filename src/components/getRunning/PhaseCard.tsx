import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminDisplayName } from "@/data/orgAdmins";
import type { GetRunningPhase, GetRunningPhaseKey, GetRunningTask, GetRunningTaskKey } from "@/lib/getRunning/tasks";
import { TaskRow } from "./TaskRow";

const PHASE_ORDER: GetRunningPhaseKey[] = ["get_dates", "bookable", "paperwork"];

type PhaseVisualState = "complete" | "blocking" | "neutral";

/** The same three visual states, generically derived, drive every phase: a filled-check
 *  solid card once every task is done, an accent-elevated card while an offers/booking task
 *  is still outstanding (this phase blocks the org's first offer), else a dashed, quieter
 *  card. `docs/superpowers/specs/2026-08-17-setup-settings-design/screens/01_01_Get_running.html`
 *  shows exactly one instance of each: Phase 1 (complete), Phase 2 (blocking), Phase 3
 *  (neutral) — this function generalizes that pattern to every phase/state combination. */
function derivePhaseState(tasks: GetRunningTask[]): PhaseVisualState {
  const leftCount = tasks.filter((task) => !task.done).length;
  if (leftCount === 0) return "complete";
  const hasHardBlock = tasks.some((task) => !task.done && (task.block === "offers" || task.block === "booking"));
  return hasHardBlock ? "blocking" : "neutral";
}

const CARD_CLASS: Record<PhaseVisualState, string> = {
  complete: "border border-border bg-card",
  blocking: "border border-accent-200 bg-card shadow-elev2",
  neutral: "border border-dashed border-border bg-transparent",
};

const HEADER_CLASS: Record<PhaseVisualState, string> = {
  complete: "border-b border-border",
  blocking: "border-b border-accent-100 bg-accent-50",
  neutral: "",
};

const BADGE_VARIANT: Record<PhaseVisualState, "confirmed" | "risk" | "neutral"> = {
  complete: "confirmed",
  blocking: "risk",
  neutral: "neutral",
};

function PhaseIcon({ state, index }: { state: PhaseVisualState; index: number }): JSX.Element {
  if (state === "complete") {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold ${
        state === "blocking" ? "border-primary text-accent-700" : "border-border text-[var(--text-faint)]"
      }`}
    >
      {index}
    </span>
  );
}

/** The get_dates phase renders as a single "running" summary row (the sync pipeline
 *  itself, not a per-task checklist): two inline sub-checks reflecting the `dates`/`slots`
 *  tasks' own `done` state, plus a "Resolve" action for the slots gap. The design's specific
 *  sync count ("148 dates in · synced 11:00") and held-record count are not represented in
 *  `GetRunningModel` (no such field exists yet), so they are intentionally omitted here
 *  rather than fabricated — a later phase that wires real Airtable-console data can add them. */
function GetDatesSummary({
  tasks,
  onOpenTask,
  adminNames,
}: {
  tasks: GetRunningTask[];
  onOpenTask: (key: GetRunningTaskKey) => void;
  adminNames?: string[];
}): JSX.Element {
  const { t } = useTranslation("getRunning");
  const dates = tasks.find((task) => task.key === "dates");
  const slots = tasks.find((task) => task.key === "slots");
  // This trailing control speaks for the `slots` task specifically (the header owns the
  // `dates` task's own review/waits-on affordance). Since `slots.done` implies `dates.done`
  // (a slot count needs a show to exist), an open slots task is the only thing that leaves
  // the phase incomplete here.
  const slotsOpen = slots ? !slots.done : false;

  return (
    <div className="flex flex-wrap items-center gap-3.5 px-4 py-3 text-[13px] text-muted-foreground">
      <SubCheck done={dates?.done ?? false} label={t("tasks.dates.subLabel")} />
      <span className="text-border">·</span>
      <SubCheck done={slots?.done ?? false} label={t("tasks.slots.subLabel")} />
      <div className="flex-1" />
      {/* The slots task gates on edit_scheduling, independently of the dates task's
          manage_productions. So a producer can hold one but not the other: when slots is not
          actionable, attribute it ("Waits on {admin}") rather than silently dropping the
          action, otherwise the gap reads as a dead/absent control with no explanation (the
          header, which speaks only for `dates`, may be showing an actionable link in that
          same state). */}
      {slotsOpen &&
        (slots?.actionableByViewer ? (
          <button
            type="button"
            className="text-xs font-medium text-accent-600"
            onClick={() => onOpenTask("slots")}
          >
            {t("tasks.slots.action")}
          </button>
        ) : (
          <Badge variant="neutral" className="h-[18px] px-1.5 text-[10px]">
            {t("chips.waitsOn", { name: adminDisplayName(adminNames, t("waitsOn.fallbackAdmin")) })}
          </Badge>
        ))}
    </div>
  );
}

function SubCheck({ done, label }: { done: boolean; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      {done ? (
        <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
      ) : (
        <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-border" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

/** The paperwork phase renders its three steps as tiles (letterhead / terms / countersign),
 *  per the design's 3-tile row, rather than as `TaskRow`s.
 *
 *  A tile the viewer cannot act on (`!actionableByViewer` — a producer without
 *  `edit_hire_order_settings`) drops the whole-tile click and gets the same screen-03
 *  treatment `TaskRow` gives a `!actionableByViewer` row: a "Waits on {admin}" chip next to
 *  the title and a ghost "View" button in place of the implicit whole-tile action, so it
 *  reads as attributed-and-viewable rather than a dead button with no explanation. */
function PaperworkTiles({
  tasks,
  onOpenTask,
  adminNames,
}: {
  tasks: GetRunningTask[];
  onOpenTask: (key: GetRunningTaskKey) => void;
  adminNames?: string[];
}): JSX.Element {
  const { t } = useTranslation("getRunning");
  return (
    <div className="flex gap-2.5 px-4 pb-3.5">
      {tasks.map((task) => {
        const waitsOnAdmin = !task.actionableByViewer;
        const body = (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-medium text-foreground">{t(`tasks.${task.key}.title`)}</div>
              {task.block === "issuing" && (
                <Badge variant="risk" className="h-[18px] px-1.5 text-[10px]">
                  {t("chips.blocksIssuing")}
                </Badge>
              )}
              {waitsOnAdmin && (
                <Badge variant="neutral" className="h-[18px] px-1.5 text-[10px]">
                  {t("chips.waitsOn", { name: adminDisplayName(adminNames, t("waitsOn.fallbackAdmin")) })}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs leading-[17px] text-[var(--text-faint)]">
              {t(`tasks.${task.key}.description`)}
            </div>
          </>
        );
        if (waitsOnAdmin) {
          return (
            <div
              key={task.key}
              data-testid={`paperwork-tile-${task.key}`}
              className="flex-1 rounded-[var(--radius-m)] border border-border bg-card p-3 text-left"
            >
              {body}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onOpenTask(task.key)}
              >
                {t("actions.view")}
              </Button>
            </div>
          );
        }
        return (
          <button
            key={task.key}
            data-testid={`paperwork-tile-${task.key}`}
            type="button"
            onClick={() => onOpenTask(task.key)}
            className="flex-1 rounded-[var(--radius-m)] border border-border bg-card p-3 text-left"
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

export interface PhaseCardProps {
  phase: GetRunningPhase;
  /** Kept for caller/test compatibility (`GetRunningPage` still computes it once for the
   *  header and the board). `PhaseCard` itself reads role-awareness straight off each task's
   *  own `actionableByViewer`/`adminOnly` — the single source of truth `composeGetRunning`
   *  already derived it from — rather than re-deriving anything from `role` here. */
  role: "admin" | "producer";
  onOpenTask: (key: GetRunningTaskKey) => void;
  /** The active org's admin display names (screen 03, producer board only) — threaded
   *  straight through to `TaskRow` and `PaperworkTiles` for their "Waits on {admin}" chips.
   *  Never fetched here: `GetRunningPage` owns the single `useOrgAdminNames` call. */
  adminNames?: string[];
}

/**
 * One phase card of the `/get-running` board (screen 01): header (status icon, title,
 * status badge, right-side counter, and phase-specific action link) plus a body whose
 * shape depends on the phase — the get_dates phase renders `GetDatesSummary`, the
 * paperwork phase renders `PaperworkTiles`, and the bookable phase (and any other phase
 * with ordinary tasks) renders a `TaskRow` per task.
 */
export function PhaseCard({ phase, onOpenTask, adminNames }: PhaseCardProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const state = derivePhaseState(phase.tasks);
  const leftCount = phase.tasks.filter((task) => !task.done).length;
  const blockingCount = phase.tasks.filter(
    (task) => !task.done && (task.block === "offers" || task.block === "booking"),
  ).length;
  const doneCount = phase.tasks.length - leftCount;
  const orderIndex = PHASE_ORDER.indexOf(phase.key) + 1;
  // Only the get_dates phase's header ever renders the "dates" review link (see below), so
  // this stays undefined (and unused) for every other phase.
  const datesTask = phase.key === "get_dates" ? phase.tasks.find((task) => task.key === "dates") : undefined;
  // The paperwork header's "Do it now" link opens whichever task is first not-done (mirrors
  // the click handler below). That same task drives whether the header says "Do it now" or
  // waits on an admin — a producer must never read "Do it now" above a tile that is itself
  // showing "Waits on {admin}" (the carry-forward gap this fixes).
  const firstOpenPaperworkTask =
    phase.key === "paperwork" ? (phase.tasks.find((task) => !task.done) ?? phase.tasks[0]) : undefined;

  return (
    <div className={`rounded-[var(--radius-l)] ${CARD_CLASS[state]}`} data-testid={`phase-card-${phase.key}`}>
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${HEADER_CLASS[state]}`}>
        <PhaseIcon state={state} index={orderIndex} />
        <div
          className={`text-base font-semibold tracking-[-0.1px] ${
            state === "neutral" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {t(`phases.${phase.key}.title`)}
        </div>
        <Badge variant={BADGE_VARIANT[state]}>{t(`phases.${phase.key}.status.${state}`)}</Badge>
        <div className="flex-1" />
        {phase.key === "paperwork" && state !== "complete" && firstOpenPaperworkTask ? (
          <>
            <span className="text-xs text-[var(--text-faint)]">{t("phases.paperwork.note")}</span>
            {firstOpenPaperworkTask.actionableByViewer ? (
              <button
                type="button"
                className="text-xs font-medium text-accent-600"
                onClick={() => onOpenTask(firstOpenPaperworkTask.key)}
              >
                {t("phases.paperwork.doItNow")}
              </button>
            ) : (
              <>
                <Badge variant="neutral">
                  {t("chips.waitsOn", { name: adminDisplayName(adminNames, t("waitsOn.fallbackAdmin")) })}
                </Badge>
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenTask(firstOpenPaperworkTask.key)}>
                  {t("actions.view")}
                </Button>
              </>
            )}
          </>
        ) : state === "blocking" ? (
          <span className="font-mono text-xs font-medium text-accent-600">
            {t("phases.counts.leftBlocking", { left: leftCount, blocking: blockingCount })}
          </span>
        ) : (
          <span className="font-mono text-xs text-[var(--text-faint)]">
            {t("phases.counts.doneOfTotal", { done: doneCount, total: phase.tasks.length })}
          </span>
        )}
        {datesTask &&
          (datesTask.actionableByViewer ? (
            <button type="button" className="text-xs font-medium text-accent-600" onClick={() => onOpenTask("dates")}>
              {t("tasks.dates.action")}
            </button>
          ) : (
            <>
              <Badge variant="neutral">
                {t("chips.waitsOn", { name: adminDisplayName(adminNames, t("waitsOn.fallbackAdmin")) })}
              </Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenTask("dates")}>
                {t("actions.view")}
              </Button>
            </>
          ))}
      </div>

      {phase.key === "get_dates" ? (
        <GetDatesSummary tasks={phase.tasks} onOpenTask={onOpenTask} adminNames={adminNames} />
      ) : phase.key === "paperwork" ? (
        <PaperworkTiles tasks={phase.tasks} onOpenTask={onOpenTask} adminNames={adminNames} />
      ) : (
        phase.tasks.map((task) => (
          <TaskRow key={task.key} task={task} adminNames={adminNames} onOpen={onOpenTask} />
        ))
      )}
    </div>
  );
}
