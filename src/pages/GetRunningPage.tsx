import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { GetRunningHeader } from "@/components/getRunning/GetRunningHeader";
import { PhaseCard } from "@/components/getRunning/PhaseCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetRunningTaskKey } from "@/lib/getRunning/tasks";

/**
 * The `/get-running` onboarding board (screen 01): a one-page, ordered checklist that
 * replaces "read every setting page" for a fresh org. This task adds the phase list (get
 * dates in / make it bookable / paperwork) beneath the header. `selectedTask` is tracked
 * here so a later task can open a task panel beside the board — for now `onOpenTask` only
 * sets the selection, no panel is rendered yet.
 */
export default function GetRunningPage() {
  const { currentOrg, hasRole } = useAuth();
  const { model, isLoading } = useGetRunning();
  const [, setSelectedTask] = useState<GetRunningTaskKey | null>(null);
  const role = hasRole("admin") ? "admin" : "producer";

  if (isLoading || !model) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <Skeleton className="h-[140px] w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <GetRunningHeader model={model} orgName={currentOrg?.name} />
      <div className="flex flex-col gap-5">
        {model.phases.map((phase) => (
          <PhaseCard key={phase.key} phase={phase} role={role} onOpenTask={setSelectedTask} />
        ))}
      </div>
    </div>
  );
}
