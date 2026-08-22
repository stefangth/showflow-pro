import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { GetRunningHeader } from "@/components/getRunning/GetRunningHeader";
import { PhaseCard } from "@/components/getRunning/PhaseCard";
import { RetiredBoard } from "@/components/getRunning/RetiredBoard";
import { TaskPanel } from "@/components/getRunning/TaskPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/app.config";
import { producerRoleNote, roleExplainerLinkLabel, ROLE_EXPLAINER_LINK_ROUTE } from "@/lib/dashboard/moduleOnboarding";
import type { GetRunningModel, GetRunningTask, GetRunningTaskKey } from "@/lib/getRunning/tasks";

/**
 * Screen 03 of the setup/settings design's "nothing-on org" edge state: an org entitled
 * to neither `booking_flow` nor `hire_orders` has no board to show (both phases the
 * composer would otherwise build are gated on those flags, so `model.phases` is already
 * empty) — a bare "nothing to set up" card in place of `RetiredBoard`/the phase list, so
 * this reads as "there is nothing here yet" rather than "you finished everything".
 */
function NothingToSetUp(): JSX.Element {
  const { t } = useTranslation("getRunning");
  return (
    <div
      data-testid="get-running-nothing"
      className="flex w-full max-w-[560px] flex-col gap-2 rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-elev3"
    >
      <h1 className="text-base font-semibold tracking-[-0.1px] text-foreground">{t("nothingToSetUp.title")}</h1>
      <p className="text-control leading-[19px] text-muted-foreground text-pretty">{t("nothingToSetUp.body")}</p>
    </div>
  );
}

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
  const { t: tOnboarding } = useTranslation("onboarding");
  const { currentOrg, hasRole } = useAuth();
  const { model, isLoading } = useGetRunning();
  const [selectedTask, setSelectedTask] = useState<GetRunningTaskKey | null>(null);
  // The board itself is admin/producer-only (the nav item is gated the same way), so an
  // artist reaches `role === "artist"` only via a direct URL hit — the early return below
  // bounces them to Availability before any board markup renders. Narrowing this union via
  // that return is what lets `role` keep flowing into GetRunningHeader/PhaseCard's
  // "admin" | "producer" prop unchanged for the rest of the function.
  const role = hasRole("admin") ? "admin" : hasRole("producer") ? "producer" : "artist";
  const orgId = currentOrg?.id ?? null;
  // Only the producer board ever names an admin (screen 03's "Waits on {admin}" chips + the
  // header's "wait on {admin}" headline), so the fetch is skipped entirely for an admin
  // viewer, who never renders either.
  const { data: adminNames } = useOrgAdminNames(currentOrg?.id, { enabled: role === "producer" });

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

  // The artist board is screen 08, a later phase — until it lands, a direct URL hit
  // bounces to Availability rather than rendering (or half-rendering) the admin/producer
  // board an artist has no business seeing.
  if (role === "artist") {
    return <Navigate to={ROUTES.AVAILABILITY} replace />;
  }

  // An org entitled to neither module has nothing for this board to show — both phases
  // the composer would otherwise build are gated on bookingOn/hireOrdersOn, so
  // model.phases is already empty here; render a single explanatory card instead of an
  // empty board or the "everything's done" retirement state.
  if (model.bookingOn === false && model.hireOrdersOn === false) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <NothingToSetUp />
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
      {/* Screen 04 of the setup/settings design: once every applicable task is done, the
          multi-phase board (header + phase checklist) retires into RetiredBoard's single
          summary row + two info cards, and the producer role-cover footer goes with it
          (nothing is left for it to explain once nothing blocks anyone). */}
      {model.complete ? (
        <RetiredBoard model={model} orgId={orgId} />
      ) : (
        <>
          <GetRunningHeader model={model} orgName={currentOrg?.name} role={role} adminNames={adminNames} />
          <div className={selected ? "grid items-start gap-5 lg:grid-cols-[1fr_440px]" : "flex flex-col gap-5"}>
            <div className="flex min-w-0 flex-col gap-5">
              {model.phases.map((phase) => (
                <PhaseCard
                  key={phase.key}
                  phase={phase}
                  role={role}
                  adminNames={adminNames}
                  onOpenTask={setSelectedTask}
                  activeKey={selectedTask}
                />
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
          {/* Role-cover footer (screen 03): a producer's reachable explanation of what
              "Production Team" covers versus the admin. Same copy + link BookingProducerWaitingCard
              already carries (the `onboarding` catalog's `producerRole.note`), laid out as the
              design's icon + text + right-aligned link row rather than that card's stacked one. */}
          {role === "producer" && (
            <div className="flex items-center gap-3 rounded-[var(--radius-l)] border border-border bg-card px-4 py-3">
              <Users className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" aria-hidden="true" />
              <p className="text-xs leading-[17px] text-muted-foreground">{producerRoleNote(tOnboarding)}</p>
              <div className="flex-1" />
              <Link to={ROLE_EXPLAINER_LINK_ROUTE} className="shrink-0 text-xs font-medium text-accent-600">
                {roleExplainerLinkLabel(tOnboarding)}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
