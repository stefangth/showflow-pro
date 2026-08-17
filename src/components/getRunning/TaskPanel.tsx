import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GetRunningTask } from "@/lib/getRunning/tasks";
import { TaskPanelEditor } from "./taskPanelRegistry";

export interface TaskPanelProps {
  task: GetRunningTask;
  orgId: string | null;
  /** "Later" (footer) and the header close control both call this — dismiss with
   *  nothing written. Nothing here undoes a save the editor already made; it only closes
   *  the panel. */
  onClose: () => void;
  /** Called after the mounted editor's own `onDone` fires (a successful save). Optional:
   *  read-only tasks (ladder/eligibility) and link-out tasks (dates/people/team) never
   *  reach `onDone` at all, since their editors have no save step to complete. When
   *  omitted, `onDone` falls back to `onClose`. */
  onNext?: () => void;
}

/**
 * The task panel frame (screen 02 · `02_02_Task_panels.html`): one shell shared by all
 * eleven tasks — eyebrow, title, intro body, a scrollable slot hosting the task's own
 * reused step editor (via `taskPanelRegistry`), and a footer note + "Later" dismiss.
 *
 * Screen 02 mocks a second, generic primary submit button in the footer next to "Later"
 * ("Keep offers" / "Confirm timing" / "Save letterhead"). Every reused editor already
 * renders its OWN primary action inline instead — FlowStep's "Use {preset}", TimingStep's
 * "Save timing", LetterheadStep's confirm button, SlotsStep's "Save slot counts", and so
 * on — each wired to that editor's own mutation, its own validation and its own disabled
 * state. A second, frame-level "primary" button with no mutation behind it would either
 * do nothing or have to reach into each editor's internal state to drive it, which is
 * exactly the modification this task was told to avoid ("wrap, don't modify"). So the
 * footer here stays the frame's own chrome only: a task-specific note (what the change
 * applies to / whether it's logged) plus "Later", which just closes the panel. The
 * editor's own save button already sits at the bottom of the scroll body, directly above
 * this footer, so the visual result still reads as "one action to finish this task."
 */
export function TaskPanel({ task, orgId, onClose, onNext }: TaskPanelProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  const handleDone = () => (onNext ? onNext() : onClose());

  return (
    <div
      data-testid="task-panel"
      className="flex h-fit max-h-[calc(100vh-140px)] w-[440px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev3"
    >
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-600">
            {t(`panel.eyebrow.${task.key}`)}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("panel.close")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.3px] text-foreground">
          {t(`tasks.${task.key}.title`)}
        </div>
        <p className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground text-pretty">
          {t(`tasks.${task.key}.description`)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <TaskPanelEditor task={task} orgId={orgId} onDone={handleDone} />
      </div>

      <div className="flex items-center gap-2.5 border-t border-border bg-muted px-4 py-3.5">
        <span className="text-xs text-muted-foreground">{t(`panel.footerNote.${task.key}`)}</span>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("panel.later")}
        </Button>
      </div>
    </div>
  );
}
