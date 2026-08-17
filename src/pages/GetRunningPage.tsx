import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { GetRunningHeader } from "@/components/getRunning/GetRunningHeader";
import { PhaseCard } from "@/components/getRunning/PhaseCard";
import { TaskPanel } from "@/components/getRunning/TaskPanel";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetRunningModel, GetRunningTask, GetRunningTaskKey } from "@/lib/getRunning/tasks";

/** The first task worth opening automatically: the earliest not-done task (in board
 *  order) that holds up either offers or booking — the same "first offer blocker" set
 *  `GetRunningHeader`/`canFirstOffer` already use. `null` when nothing blocks (a fresh
 *  board with no offers/booking task outstanding never steals focus onto a panel). */
function firstBlockingTask(model: GetRunningModel): GetRunningTask | null {
  const flat = model.phases.flatMap((phase) => phase.tasks);
  return flat.find((task) => !task.done && (task.block === "offers" || task.block === "booking")) ?? null;
}

/**
 * The `/get-running` onboarding board (screen 01): a one-page, ordered checklist that
 * replaces "read every setting page" for a fresh org. This task opens a `TaskPanel`
 * beside the board (screen 02) whenever a task is selected — the board column narrows to
 * make room (grid `1fr 440px`) — and defaults to the first offers/booking-blocking task
 * on mount, so a fresh org lands with its first real decision already open.
 */
export default function GetRunningPage() {
  const { currentOrg, hasRole } = useAuth();
  const { model, isLoading } = useGetRunning();
  const [selectedTask, setSelectedTask] = useState<GetRunningTaskKey | null>(null);
  const role = hasRole("admin") ? "admin" : "producer";
  const orgId = currentOrg?.id ?? null;

  // Runs once per mount, not on every model refetch: without the ref guard, a viewer who
  // deliberately closed the panel (selectedTask -> null) would have it reopened on the
  // next background refetch, since the same first-blocking task would still be found.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !model) return;
    autoOpenedRef.current = true;
    const task = firstBlockingTask(model);
    if (task) setSelectedTask(task.key);
  }, [model]);

  if (isLoading || !model) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <Skeleton className="h-[140px] w-full" />
      </div>
    );
  }

  const flatTasks = model.phases.flatMap((phase) => phase.tasks);
  const selected = selectedTask ? (flatTasks.find((task) => task.key === selectedTask) ?? null) : null;

  // Advance to the next not-done task in board order once the open panel's editor saves
  // successfully; close the panel once nothing is left. A task can go from selected to
  // "no longer in flatTasks" between renders (its phase's module toggled off, or the
  // model reshaped), in which case `selected` above is already null and this never runs.
  const handleNext = () => {
    if (!selectedTask) return;
    const idx = flatTasks.findIndex((task) => task.key === selectedTask);
    const next = flatTasks.slice(idx + 1).find((task) => !task.done);
    setSelectedTask(next ? next.key : null);
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <GetRunningHeader model={model} orgName={currentOrg?.name} />
      <div className={selected ? "grid items-start gap-5 lg:grid-cols-[1fr_440px]" : "flex flex-col gap-5"}>
        <div className="flex min-w-0 flex-col gap-5">
          {model.phases.map((phase) => (
            <PhaseCard key={phase.key} phase={phase} role={role} onOpenTask={setSelectedTask} />
          ))}
        </div>
        {selected && (
          <TaskPanel
            task={selected}
            orgId={orgId}
            onClose={() => setSelectedTask(null)}
            onNext={handleNext}
          />
        )}
      </div>
    </div>
  );
}
