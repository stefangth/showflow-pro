import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
}: {
  tasks: GetRunningTask[];
  onOpenTask: (key: GetRunningTaskKey) => void;
}): JSX.Element {
  const { t } = useTranslation("getRunning");
  const dates = tasks.find((task) => task.key === "dates");
  const slots = tasks.find((task) => task.key === "slots");

  return (
    <div className="flex flex-wrap items-center gap-3.5 px-4 py-3 text-[13px] text-muted-foreground">
      <SubCheck done={dates?.done ?? false} label={t("tasks.dates.subLabel")} />
      <span className="text-border">·</span>
      <SubCheck done={slots?.done ?? false} label={t("tasks.slots.subLabel")} />
      <div className="flex-1" />
      <button
        type="button"
        className="text-xs font-medium text-accent-600"
        onClick={() => onOpenTask("slots")}
      >
        {t("tasks.slots.action")}
      </button>
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
 *  per the design's 3-tile row, rather than as `TaskRow`s. */
function PaperworkTiles({
  tasks,
  onOpenTask,
}: {
  tasks: GetRunningTask[];
  onOpenTask: (key: GetRunningTaskKey) => void;
}): JSX.Element {
  const { t } = useTranslation("getRunning");
  return (
    <div className="flex gap-2.5 px-4 pb-3.5">
      {tasks.map((task) => (
        <button
          key={task.key}
          type="button"
          onClick={() => onOpenTask(task.key)}
          className="flex-1 rounded-[var(--radius-m)] border border-border bg-card p-3 text-left"
        >
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-medium text-foreground">{t(`tasks.${task.key}.title`)}</div>
            {task.block === "issuing" && (
              <Badge variant="risk" className="h-[18px] px-1.5 text-[10px]">
                {t("chips.blocksIssuing")}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs leading-[17px] text-[var(--text-faint)]">
            {t(`tasks.${task.key}.description`)}
          </div>
        </button>
      ))}
    </div>
  );
}

export interface PhaseCardProps {
  phase: GetRunningPhase;
  role: "admin" | "producer";
  onOpenTask: (key: GetRunningTaskKey) => void;
}

/**
 * One phase card of the `/get-running` board (screen 01): header (status icon, title,
 * status badge, right-side counter, and phase-specific action link) plus a body whose
 * shape depends on the phase — the get_dates phase renders `GetDatesSummary`, the
 * paperwork phase renders `PaperworkTiles`, and the bookable phase (and any other phase
 * with ordinary tasks) renders a `TaskRow` per task.
 */
export function PhaseCard({ phase, role, onOpenTask }: PhaseCardProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const state = derivePhaseState(phase.tasks);
  const leftCount = phase.tasks.filter((task) => !task.done).length;
  const blockingCount = phase.tasks.filter(
    (task) => !task.done && (task.block === "offers" || task.block === "booking"),
  ).length;
  const doneCount = phase.tasks.length - leftCount;
  const orderIndex = PHASE_ORDER.indexOf(phase.key) + 1;

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
        {phase.key === "paperwork" && state !== "complete" ? (
          <>
            <span className="text-xs text-[var(--text-faint)]">{t("phases.paperwork.note")}</span>
            <button
              type="button"
              className="text-xs font-medium text-accent-600"
              onClick={() => onOpenTask(phase.tasks.find((task) => !task.done)?.key ?? phase.tasks[0].key)}
            >
              {t("phases.paperwork.doItNow")}
            </button>
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
        {phase.key === "get_dates" && (
          <button type="button" className="text-xs font-medium text-accent-600" onClick={() => onOpenTask("dates")}>
            {t("tasks.dates.action")}
          </button>
        )}
      </div>

      {phase.key === "get_dates" ? (
        <GetDatesSummary tasks={phase.tasks} onOpenTask={onOpenTask} />
      ) : phase.key === "paperwork" ? (
        <PaperworkTiles tasks={phase.tasks} onOpenTask={onOpenTask} />
      ) : (
        phase.tasks.map((task) => (
          <TaskRow key={task.key} task={task} viewerRole={role} onOpen={onOpenTask} />
        ))
      )}
    </div>
  );
}
