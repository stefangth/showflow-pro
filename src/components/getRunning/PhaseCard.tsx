import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminDisplayName } from "@/data/orgAdmins";
import type { GetRunningPhase, GetRunningPhaseKey, GetRunningTask, GetRunningTaskKey } from "@/lib/getRunning/tasks";
import { TaskRow } from "./TaskRow";

const PHASE_ORDER: GetRunningPhaseKey[] = ["get_dates", "bookable", "paperwork"];

type PhaseVisualState = "complete" | "blocking" | "active" | "dormant";

/** Four visual states drive every phase, structurally: `complete` (every task done, solid
 *  card + green badge), `blocking` (an offers/booking task is still outstanding, so this
 *  phase holds up the first offer — accent-elevated card), `active` (in progress: at least
 *  one task done but not all, nothing blocking — a plain SOLID card, because the phase is
 *  being worked on) and `dormant` (nothing started yet and nothing blocking — a dashed,
 *  recessed card that reads as "not your concern yet").
 *
 *  Splitting the old single "neutral" into `active` vs `dormant` is what keeps the board
 *  coherent in EVERY state combination, not just the design's one worked example: a phase
 *  that is half-done no longer renders as a ghosted, dashed, "not started yet" card next to
 *  a solid completed one. `screens/01_01_Get_running.html` shows get_dates=complete,
 *  bookable=blocking, paperwork=dormant; this generalises that to the rest of the matrix. */
function derivePhaseState(tasks: GetRunningTask[]): PhaseVisualState {
  const doneCount = tasks.filter((task) => task.done).length;
  if (tasks.length > 0 && doneCount === tasks.length) return "complete";
  const hasHardBlock = tasks.some((task) => !task.done && (task.block === "offers" || task.block === "booking"));
  if (hasHardBlock) return "blocking";
  return doneCount > 0 ? "active" : "dormant";
}

/** The solid neutral surface shared by the `complete` and `active` states (both read as a
 *  plain, present card): kept as one const so the two cannot silently drift apart. */
const SOLID_CARD = "border border-border bg-card";

const CARD_CLASS: Record<PhaseVisualState, string> = {
  complete: SOLID_CARD,
  blocking: "border border-accent-200 bg-card shadow-elev2",
  active: SOLID_CARD,
  dormant: "border border-dashed border-border bg-transparent",
};

const HEADER_CLASS: Record<PhaseVisualState, string> = {
  complete: "border-b border-border",
  blocking: "border-b border-accent-100 bg-accent",
  active: "border-b border-border",
  dormant: "",
};

const BADGE_VARIANT: Record<PhaseVisualState, "confirmed" | "risk" | "neutral"> = {
  complete: "confirmed",
  blocking: "risk",
  active: "neutral",
  dormant: "neutral",
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
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-eyebrow font-semibold ${
        state === "blocking" ? "border-primary text-accent-foreground" : "border-border text-[var(--text-faint)]"
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
    <div className="flex flex-wrap items-center gap-3.5 px-4 py-3 text-control text-muted-foreground">
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
          <Badge variant="neutral" className="h-[18px] px-1.5 text-eyebrow">
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
  activeKey,
}: {
  tasks: GetRunningTask[];
  onOpenTask: (key: GetRunningTaskKey) => void;
  adminNames?: string[];
  activeKey?: GetRunningTaskKey | null;
}): JSX.Element {
  const { t } = useTranslation("getRunning");
  return (
    // py-3.5 (not pb-only): in the complete/active states the header carries a bottom
    // divider, and top padding is what keeps these tiles off that line instead of butting
    // flush against it (matches GetDatesSummary's symmetric py). The dormant state has no
    // divider, so the extra top gap simply reads as breathing room.
    <div className="flex gap-2.5 px-4 py-3.5">
      {tasks.map((task) => {
        const waitsOnAdmin = !task.actionableByViewer;
        const active = activeKey === task.key;
        const body = (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {/* A done tile carries the same filled-check done marker a done TaskRow does,
                  so "this document is set" reads at a glance and looks done the same way
                  across every phase. */}
              {task.done && (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
              <div
                className={`text-control font-medium ${
                  active ? "text-primary" : task.done ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {t(`tasks.${task.key}.title`)}
              </div>
              {/* "Blocks issuing" is what the tile costs while OUTSTANDING; once done it holds
                  up nothing, so guard on !done exactly as TaskRow/derivePhaseState do (block
                  itself stays the static "what it holds up if outstanding" value). */}
              {!task.done && task.block === "issuing" && (
                <Badge variant="risk" className="h-[18px] px-1.5 text-eyebrow">
                  {t("chips.blocksIssuing")}
                </Badge>
              )}
              {waitsOnAdmin && (
                <Badge variant="neutral" className="h-[18px] px-1.5 text-eyebrow">
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
              data-active={active}
              className={`flex-1 rounded-[var(--radius-m)] border p-3 text-left shadow-elev1 transition-colors ${
                active ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
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
            data-active={active}
            type="button"
            onClick={() => onOpenTask(task.key)}
            className={`flex-1 rounded-[var(--radius-m)] border p-3 text-left shadow-elev1 transition-colors ${
              active ? "border-primary bg-primary/10" : "border-border bg-card"
            }`}
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
  /** The task whose panel is currently popped out beside the board, so the matching row/tile
   *  in this phase can render its selected (violet `primary`) active state. `null` when no
   *  panel is open. */
  activeKey?: GetRunningTaskKey | null;
}

/**
 * One phase card of the `/get-running` board (screen 01): header (status icon, title,
 * status badge, right-side counter, and phase-specific action link) plus a body whose
 * shape depends on the phase — the get_dates phase renders `GetDatesSummary`, the
 * paperwork phase renders `PaperworkTiles`, and the bookable phase (and any other phase
 * with ordinary tasks) renders a `TaskRow` per task.
 */
export function PhaseCard({ phase, onOpenTask, adminNames, activeKey }: PhaseCardProps): JSX.Element {
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

  // overflow-hidden below clips the tinted (blocking) header to the card's rounded corners.
  // It also clips anything a child paints OUTSIDE its own box (a focus ring, a shadow, an
  // inline popover): today's action buttons and paperwork tiles sit within the card's
  // px-4/pb-3.5 padding so nothing is clipped, but keep any new edge-flush, ring- or
  // popover-bearing control off the card border for that reason.
  return (
    <div className={`overflow-hidden rounded-[var(--radius-l)] ${CARD_CLASS[state]}`} data-testid={`phase-card-${phase.key}`}>
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${HEADER_CLASS[state]}`}>
        <PhaseIcon state={state} index={orderIndex} />
        <div
          className={`text-base font-semibold tracking-[-0.1px] ${
            state === "dormant" ? "text-muted-foreground" : "text-foreground"
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
          <span className="font-mono text-xs font-medium text-accent-foreground">
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
        <PaperworkTiles tasks={phase.tasks} onOpenTask={onOpenTask} adminNames={adminNames} activeKey={activeKey} />
      ) : (
        phase.tasks.map((task) => (
          <TaskRow
            key={task.key}
            task={task}
            adminNames={adminNames}
            onOpen={onOpenTask}
            active={activeKey === task.key}
          />
        ))
      )}
    </div>
  );
}
