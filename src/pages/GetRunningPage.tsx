import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { GetRunningHeader } from "@/components/getRunning/GetRunningHeader";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The `/get-running` onboarding board (screen 01): a one-page, ordered checklist that
 * replaces "read every setting page" for a fresh org. This task ships the header +
 * progress card only — the phase list (get dates in / make it bookable / paperwork)
 * and the task panel land in later tasks.
 */
export default function GetRunningPage() {
  const { currentOrg } = useAuth();
  const { model, isLoading } = useGetRunning();

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
    </div>
  );
}
