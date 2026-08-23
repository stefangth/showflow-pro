import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { HeroCard } from "@/components/getRunning/v3/board/HeroCard";
import { StillShutCard } from "@/components/getRunning/v3/board/StillShutCard";
import { PhaseIconRail } from "@/components/getRunning/v3/board/PhaseIconRail";
import { PhaseRow } from "@/components/getRunning/v3/board/PhaseRow";
import { WizardShell } from "@/components/getRunning/v3/WizardShell";
import { StepBodyV3 } from "@/components/getRunning/v3/stepRegistryV3";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { adminDisplayName } from "@/data/orgAdmins";
import { visibleSteps } from "@/lib/getRunning/steps";
import type { GetRunningModelV3, GetRunningPhaseKey, GetRunningStep, GetRunningStepKey } from "@/lib/getRunning/steps";

/**
 * Screen state for an org entitled to neither `booking_flow` nor `hire_orders`: both
 * phases the composer would otherwise build are gated on those flags, so `model.phases`
 * is already empty. Mirrors v1's `NothingToSetUp` (`GetRunningPage.tsx`), but reads the
 * v3 copy catalog since v3 doesn't share v1's `GetRunningModel` type and can't reuse that
 * component directly.
 */
function NothingToSetUpV3(): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  return (
    <div
      data-testid="get-running-v3-nothing"
      className="flex w-full max-w-[560px] flex-col gap-2 rounded-l border border-border bg-card p-6 shadow-elev3"
    >
      <h1 className="text-base font-semibold tracking-[-0.1px] text-foreground">{t("nothingToSetUp.title")}</h1>
      <p className="text-control leading-[19px] text-muted-foreground text-pretty">{t("nothingToSetUp.body")}</p>
    </div>
  );
}

/**
 * Retired-board state for a `model.complete` v3 board: a single summary row in place of
 * the hero/still-shut/rails/phase-row stack. v1's `RetiredBoard` takes the v1
 * `GetRunningModel` type (a different shape from `GetRunningModelV3`), and per the task
 * brief this is built inline rather than widening that component's prop type or
 * duplicating v1's dismissal wiring for a board that isn't v1's.
 */
function RetiredBoardV3({ model }: { model: GetRunningModelV3 }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  return (
    <div
      data-testid="get-running-v3-retired"
      className="flex w-full flex-col gap-2 rounded-l border border-border bg-card p-6 shadow-elev3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-[-0.1px] text-foreground">{t("retired.title")}</div>
          <p className="mt-0.5 text-control leading-[19px] text-muted-foreground text-pretty">{t("retired.body")}</p>
        </div>
        <Metric size="body" className="text-muted-foreground">
          {t("retired.count", { done: model.doneCount, total: model.totalCount })}
        </Metric>
      </div>
    </div>
  );
}

/** The first step worth opening automatically: the earliest not-done VISIBLE step (in
 *  board order) that holds up either offers or booking. Mirrors v1 `firstBlockingTask`
 *  (`GetRunningPage.tsx`). Skips `hidden` steps (a manual dates source's `connect`/`map`
 *  can be simultaneously "not done" and hard-blocking, since they inherit `get_dates`'
 *  board-level hard block, so without this filter the board would auto-open straight into
 *  a step it should never show for that org). `null` when nothing blocks. */
function firstBlockingStep(model: GetRunningModelV3): { phase: GetRunningPhaseKey; key: GetRunningStepKey } | null {
  const flat = model.phases.flatMap((phase) => visibleSteps(phase.steps));
  const found = flat.find((step) => !step.done && (step.block === "offers" || step.block === "booking"));
  return found ? { phase: found.phase, key: found.key } : null;
}

/** The step a phase opens on when entered without a specific step (`PhaseRow.onOpen`):
 *  the first not-done VISIBLE step, else the phase's first visible step. Never returns a
 *  hidden step's key. */
function firstStepForPhase(steps: GetRunningStep[]): GetRunningStepKey {
  const vis = visibleSteps(steps);
  return vis.find((step) => !step.done)?.key ?? vis[0]?.key ?? steps[0].key;
}

/**
 * The Wireflow v3 `/get-running` board (Task 9): composes the Task 8 board pieces
 * (`HeroCard`, `StillShutCard`, `PhaseIconRail`, `PhaseRow`) with the Task 6/7 wizard
 * (`WizardShell` + `StepBodyV3`), matching `BoardPhases.dc.html`'s board layout and
 * `Coverage.dc.html`'s inline-expansion behavior: selecting a phase (from the hero card's
 * "open next", a rail icon, or a phase row's own action) swaps that phase's row for the
 * wizard shell in place, while the other phases stay collapsed to one-line rows.
 *
 * `context` distinguishes the standalone `/get-running` page render from a future
 * embedded-in-Settings render: "page" adds the page's own padding, "settings" assumes its
 * host already provides a content frame.
 */
export function GetRunningBoardV3({ context }: { context: "page" | "settings" }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const role: "admin" | "producer" = hasRole("admin") ? "admin" : "producer";
  const { model, isLoading } = useGetRunningV3();

  // Only a producer viewer ever names an admin ("waits on {admin}" below) — skipped
  // entirely for an admin viewer, same gating shape as v1's GetRunningPage.
  const { data: adminNames } = useOrgAdminNames(currentOrg?.id, { enabled: role === "producer" });

  const [selectedPhase, setSelectedPhase] = useState<GetRunningPhaseKey | null>(null);
  const [selectedStep, setSelectedStep] = useState<GetRunningStepKey | null>(null);
  const allStepsCardRef = useRef<HTMLDivElement | null>(null);

  // Runs once per mount, not on every model refetch (mirrors v1's `autoOpenedRef`):
  // without the ref guard, a viewer who deliberately collapsed the wizard would have it
  // reopened on the next background refetch, since the same first-blocking step would
  // still be found.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !model) return;
    autoOpenedRef.current = true;
    const step = firstBlockingStep(model);
    if (step) {
      setSelectedPhase(step.phase);
      setSelectedStep(step.key);
    }
  }, [model]);

  if (isLoading || !model) {
    return (
      <div className={context === "page" ? "flex flex-col gap-5 p-6" : "flex flex-col gap-5"}>
        <Skeleton className="h-[140px] w-full" />
      </div>
    );
  }

  if (!model.bookingOn && !model.hireOrdersOn) {
    return (
      <div className={context === "page" ? "flex flex-col gap-5 p-6" : "flex flex-col gap-5"}>
        <NothingToSetUpV3 />
      </div>
    );
  }

  if (model.complete) {
    return (
      <div className={context === "page" ? "flex flex-col gap-5 p-6" : "flex flex-col gap-5"}>
        <RetiredBoardV3 model={model} />
      </div>
    );
  }

  const handleOpenStep = (phase: GetRunningPhaseKey, step: GetRunningStepKey) => {
    // Defense in depth: a phase with `waitsOn` set can't be opened from any path (rail,
    // hero, row), even if a caller ever forgets to gate its own click handler.
    const phaseObj = model.phases.find((p) => p.key === phase);
    if (!phaseObj || phaseObj.waitsOn != null) return;
    // Defense in depth: nothing in the UI currently offers a hidden step as a click target
    // (the rail filters them, the hero card's `nextStep` already excludes them), but if a
    // caller ever passes one anyway, redirect to the phase's first visible not-done step
    // instead of opening the wizard on a step that shouldn't exist for this org.
    const isVisibleTarget = visibleSteps(phaseObj.steps).some((s) => s.key === step);
    setSelectedPhase(phase);
    setSelectedStep(isVisibleTarget ? step : firstStepForPhase(phaseObj.steps));
  };

  const handleOpenPhase = (phase: GetRunningPhaseKey) => {
    const phaseObj = model.phases.find((p) => p.key === phase);
    if (!phaseObj || phaseObj.waitsOn != null) return;
    setSelectedPhase(phase);
    setSelectedStep(firstStepForPhase(phaseObj.steps));
  };

  const handleCollapse = () => {
    setSelectedPhase(null);
    setSelectedStep(null);
  };

  const handleSeeAll = () => {
    allStepsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Advance to the next not-done step in the open phase once its editor saves
  // successfully; collapse back to the board once nothing is left in that phase.
  // Mirrors v1 `handleNext` (`GetRunningPage.tsx`).
  const handleStepDone = () => {
    const phaseObj = selectedPhase ? model.phases.find((p) => p.key === selectedPhase) : null;
    if (!phaseObj || !selectedStep) return;
    const vis = visibleSteps(phaseObj.steps);
    const idx = vis.findIndex((step) => step.key === selectedStep);
    const next = vis.slice(idx + 1).find((step) => !step.done);
    if (next) {
      setSelectedStep(next.key);
    } else {
      handleCollapse();
    }
  };

  const activePhase = selectedPhase ? model.phases.find((p) => p.key === selectedPhase) : null;
  const rawActiveStep = activePhase && selectedStep ? activePhase.steps.find((s) => s.key === selectedStep) : null;
  // Guard against `selectedStep` resolving to a step that has become hidden since it was
  // selected (e.g. the org's dates source was switched from "airtable" to "manual" while
  // `connect` was the open step): fall back to the phase's first visible not-done step, or
  // render nothing (the board falls through to the collapsed `PhaseRow` for this phase)
  // when the whole phase has no visible step left to show.
  const activeStep =
    rawActiveStep && !rawActiveStep.hidden
      ? rawActiveStep
      : (activePhase ? visibleSteps(activePhase.steps).find((s) => !s.done) : undefined) ?? null;

  // A producer viewer waits on the admin whenever any not-done step is not theirs to act
  // on; the same "who does this wait on" signal PhaseRow/WizardShell already read per
  // step, just rolled up to a single board-level line.
  const waitsOnAdmin =
    role === "producer" && model.phases.some((phase) => phase.steps.some((step) => !step.done && !step.actionableByViewer));
  const adminName = adminDisplayName(adminNames, t("footerRole.fallbackAdmin"));

  return (
    <div className={context === "page" ? "flex flex-col gap-5 p-6" : "flex flex-col gap-5"}>
      <div>
        <Eyebrow tone="accent">{t("header.eyebrow", { org: currentOrg?.name ?? "" })}</Eyebrow>
        <h1 className="mt-2 text-display-sm font-semibold tracking-[-0.4px] text-foreground">{t("header.title")}</h1>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex flex-1 gap-[3px]">
            {Array.from({ length: model.totalCount }, (_, i) => i < model.doneCount).map((filled, i) => (
              <div
                key={i}
                data-testid="get-running-v3-tick"
                data-filled={filled ? "true" : "false"}
                className={`h-[3px] flex-1 rounded-full ${filled ? "bg-primary" : "bg-border"}`}
              />
            ))}
          </div>
          <Metric size="body" className="shrink-0 text-muted-foreground">
            {t("progress.done", { done: model.doneCount, total: model.totalCount })}
          </Metric>
        </div>
      </div>

      <HeroCard model={model} onOpenNext={handleOpenStep} onSeeAll={handleSeeAll} />
      <StillShutCard model={model} />

      <div ref={allStepsCardRef} data-testid="all-steps-card" className="rounded-l border border-border bg-card p-4">
        <Eyebrow>{t("rails.title", { count: model.totalCount })}</Eyebrow>
        <p className="mt-1 text-xs leading-[17px] text-muted-foreground">{t("rails.hint")}</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          {model.phases.map((phase) => (
            <PhaseIconRail
              key={phase.key}
              phase={phase}
              locked={phase.waitsOn != null}
              onOpenStep={(key) => handleOpenStep(phase.key, key)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {model.phases.map((phase, i) =>
          selectedPhase === phase.key && activePhase && activeStep ? (
            <WizardShell
              key={phase.key}
              phaseKey={phase.key}
              steps={visibleSteps(activePhase.steps)}
              activeKey={activeStep.key}
              onSelectStep={(key) => setSelectedStep(key)}
              onCollapse={handleCollapse}
            >
              <StepBodyV3 step={activeStep} orgId={orgId} onDone={handleStepDone} />
            </WizardShell>
          ) : (
            <div key={phase.key} className="overflow-hidden rounded-l border border-border bg-card">
              <PhaseRow phase={phase} index={i + 1} model={model} onOpen={handleOpenPhase} />
            </div>
          ),
        )}
      </div>

      {role === "producer" && (
        <div className="flex items-center gap-3 rounded-l border border-border bg-card px-4 py-3">
          <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs leading-[17px] text-muted-foreground">{t("footerRole.producer")}</p>
          <div className="flex-1" />
          {waitsOnAdmin && (
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {t("footerRole.waitsOnAdmin", { name: adminName })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
