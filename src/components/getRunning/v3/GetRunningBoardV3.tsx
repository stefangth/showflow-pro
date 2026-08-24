import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { HeroCard } from "@/components/getRunning/v3/board/HeroCard";
import { StillShutCard } from "@/components/getRunning/v3/board/StillShutCard";
import { PhaseIconRail } from "@/components/getRunning/v3/board/PhaseIconRail";
import { PhaseRow } from "@/components/getRunning/v3/board/PhaseRow";
import { WizardShell } from "@/components/getRunning/v3/WizardShell";
import { StepBodyV3 } from "@/components/getRunning/v3/stepRegistryV3";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { ROUTES } from "@/config/app.config";
import { adminDisplayName } from "@/data/orgAdmins";
import { visibleSteps } from "@/lib/getRunning/steps";
import { stepHeadingKeys } from "@/lib/getRunning/stepHeading";
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
 *
 * Rendered as `<RetiredBoardV3 />` (not called as a bare function), so it's a proper
 * function component and `useRailDismissed` below is legal per the Rules of Hooks.
 * `orgId` is passed in from the parent rather than re-derived here, matching v1's
 * `RetiredBoard` prop shape and keeping this in sync with the same `useAuth`-derived
 * value the rest of `GetRunningBoardV3` uses. "Hide from the sidebar" shares v1's
 * `useRailDismissed("getRunning", orgId)` key, so dismissing from either board hides the
 * same sidebar item, and renders in both contexts. "Manage in Settings" opens the Settings
 * mirror of this same board (`GetRunningSettingsMirror`, `?tab=get-running`), the durable
 * home once the standalone page is no longer linked from the sidebar. That link only makes
 * sense from the standalone `/get-running` page (`context === "page"`); inside the Settings
 * mirror itself it would point at the tab already on screen, so it's omitted there.
 */
function RetiredBoardV3({
  model,
  orgId,
  context,
}: {
  model: GetRunningModelV3;
  orgId: string | null;
  context: "page" | "settings";
}): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const [, dismiss] = useRailDismissed("getRunning", orgId);
  return (
    <div
      data-testid="get-running-v3-retired"
      className="flex w-full flex-col gap-3 rounded-l border border-border bg-card p-6 shadow-elev3"
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
      <div className="flex flex-wrap items-center gap-2">
        {context === "page" && (
          <Button asChild variant="secondary" size="sm">
            <Link to={`${ROUTES.SETTINGS}?tab=get-running`}>{t("retired.manageInSettings")}</Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={dismiss}>
          {t("retired.hideFromNav")}
        </Button>
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

/** What happens once the step the wizard sits on is finished: either the next outstanding
 *  step of the same phase, or "this phase has nothing left", carrying the next phase that
 *  still has outstanding work (`null` when this was the last outstanding phase on the
 *  board, which is also the point `model.complete` flips and the retired board takes over).
 *
 *  Both the explicit path (an editor calling `onDone`) and the implicit one (the open step
 *  turning done from data alone) route through this, so the two advance identically.
 *
 *  The search wraps: the first outstanding step AFTER the current one, else the first one
 *  BEFORE it. Without the wrap, a viewer who jumped ahead in the step nav and finished a
 *  later step would be told the phase is finished while an earlier step is still open. */
type StepAdvance =
  | { kind: "next"; key: GetRunningStepKey }
  | { kind: "phaseDone"; nextPhase: GetRunningPhaseKey | null };

function advanceAfterStep(
  model: GetRunningModelV3,
  phaseKey: GetRunningPhaseKey,
  stepKey: GetRunningStepKey,
): StepAdvance | null {
  const phase = model.phases.find((p) => p.key === phaseKey);
  if (!phase) return null;
  const vis = visibleSteps(phase.steps);
  const idx = vis.findIndex((s) => s.key === stepKey);
  // `stepKey` can name a step that has since become HIDDEN (`connect`/`map` once the dates
  // source flips to "manual"). The board keeps rendering in that state by falling back to
  // the phase's first visible not-done step WITHOUT rewriting `selectedStep`, so the
  // fallback editor's `onDone` arrives here naming a step that is no longer in `vis`.
  // Repair the selection onto that same first outstanding step rather than returning null:
  // the pre-refactor `vis.slice(idx + 1)` self-healed exactly this way on `idx === -1`
  // (it degenerates to `slice(0)`), and without it the fallback editor's Continue is a
  // no-op and the wizard dead-ends.
  if (idx === -1) {
    const firstOpen = vis.find((s) => !s.done);
    return firstOpen ? { kind: "next", key: firstOpen.key } : null;
  }
  const next = vis.slice(idx + 1).find((s) => !s.done) ?? vis.slice(0, idx).find((s) => !s.done);
  if (next) return { kind: "next", key: next.key };
  // The model can be one refetch stale here (the explicit path fires the moment an editor
  // saves), so "is anything left" is only ever asked of the OTHER phases, whose steps this
  // save did not touch.
  const nextPhase = model.phases.find((p) => p.key !== phaseKey && visibleSteps(p.steps).some((s) => !s.done));
  return { kind: "phaseDone", nextPhase: nextPhase?.key ?? null };
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

  // The standalone `/get-running` page supports a `?step=<key>` deep link; the Settings
  // mirror shares the `/settings` URL with every other tab, so it must never read this
  // param (a `?step=` meant for another tab could otherwise hijack the board).
  const [searchParams] = useSearchParams();
  const stepParam = context === "page" ? searchParams.get("step") : null;

  const [selectedPhase, setSelectedPhase] = useState<GetRunningPhaseKey | null>(null);
  const [selectedStep, setSelectedStep] = useState<GetRunningStepKey | null>(null);
  const allStepsCardRef = useRef<HTMLDivElement | null>(null);

  // Both effects below inline the same open/guard logic as `handleOpenStep` further down
  // (owner phase found + `waitsOn == null`) rather than calling it: `handleOpenStep` is
  // declared after this component's early `isLoading`/`nothing-to-set-up`/`complete` returns,
  // so a render that takes one of those paths would still run these effects (all hooks called
  // before an early return still fire) with `handleOpenStep` never initialized in that
  // render's closure. Reading `owner`/`target` straight from `model` sidesteps that hazard,
  // and is exactly what `handleOpenStep` reduces to here anyway: `target` is only ever
  // considered once confirmed visible on `owner`, so its visibility redirect never fires.
  const autoOpenedRef = useRef(false);

  // `?step=` is tracked by the value LAST APPLIED, not by a one-shot boolean. A boolean was
  // wrong: it is spent on the board's first render with a model, so an in-app link that only
  // changes the query string (e.g. the cities step's "Go to productions") moved the URL and
  // nothing else — the wizard stayed where it was. It appeared to work from the Settings
  // mirror purely because that route remounts the board. Keyed on the value, a param that
  // CHANGES always re-opens, while a background model refetch (same param) never reopens a
  // wizard the viewer deliberately collapsed.
  const appliedParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!model || !stepParam || appliedParamRef.current === stepParam) return;
    const target = stepParam as GetRunningStepKey;
    const owner = model.phases.find((p) => visibleSteps(p.steps).some((s) => s.key === target));
    // A locked phase still cannot be opened from a deep link. Left unapplied (not recorded)
    // so it resolves if that phase later unlocks while the param is still on the URL.
    if (!owner || owner.waitsOn != null) return;
    appliedParamRef.current = stepParam;
    // A deep link satisfies the once-per-mount auto-open too, so the effect below does not
    // then yank the viewer to the first blocking step instead.
    autoOpenedRef.current = true;
    setSelectedPhase(owner.key);
    setSelectedStep(target);
  }, [model, stepParam]);

  // Runs once per mount, not on every model refetch (mirrors v1's `autoOpenedRef`): without
  // the ref guard, a viewer who deliberately collapsed the wizard would have it reopened on
  // the next background refetch, since the same first-blocking step would still be found.
  // Declared after the deep-link effect so a valid `?step=` (which sets `autoOpenedRef` in
  // the same commit) wins over the first-blocking auto-open; an unresolvable param falls
  // through to it.
  useEffect(() => {
    if (autoOpenedRef.current || !model) return;
    autoOpenedRef.current = true;
    const step = firstBlockingStep(model);
    if (step) {
      setSelectedPhase(step.phase);
      setSelectedStep(step.key);
    }
  }, [model]);

  // The phase handoff (both paths): name the phase that just finished, and the next one
  // that still has outstanding work. When nothing else is outstanding there is no next
  // phase to name, so the copy says so instead of inventing one — the board itself flips
  // to its retired state on the same data.
  const announcePhaseDone = useCallback(
    (finished: GetRunningPhaseKey, nextPhase: GetRunningPhaseKey | null) => {
      const phase = t(`phases.${finished}.name`);
      toast.success(
        nextPhase ? t("wizard.phaseDoneNext", { phase, next: t(`phases.${nextPhase}.name`) }) : t("wizard.phaseDone", { phase }),
      );
    },
    [t],
  );

  // Findings 06/07: a step that completes IMPLICITLY from data (the roster gains an artist,
  // the last skill gap closes, the fee row appears) used to turn green under the viewer and
  // leave them parked on a finished step, while steps that save through an explicit action
  // advanced. This effect makes the two consistent.
  //
  // `lastSeenRef` records the open step AND its done-ness at the moment it became the open
  // step, which is what separates the three cases that must stay distinct:
  //   - "it just became done while I was looking at it" -> a false->true transition on the
  //     SAME key, the only case that advances;
  //   - "it was already done when I arrived" (a viewer clicking BACK to a finished step, or
  //     reopening a finished phase) -> the first observation of that key records done:true,
  //     and no transition is ever seen, so nothing bounces them forward;
  //   - "I collapsed the wizard" -> no open step at all, so the ref is cleared and the
  //     effect returns before it can select anything. Nothing here ever opens a wizard;
  //     it only ever moves or closes one the viewer already has open.
  // A background refetch that changes nothing therefore does nothing.
  const lastSeenRef = useRef<{ key: GetRunningStepKey; done: boolean } | null>(null);
  useEffect(() => {
    if (!model || !selectedPhase || !selectedStep) {
      lastSeenRef.current = null;
      return;
    }
    const phase = model.phases.find((p) => p.key === selectedPhase);
    const step = phase ? visibleSteps(phase.steps).find((s) => s.key === selectedStep) : undefined;
    if (!step) {
      lastSeenRef.current = null;
      return;
    }
    const seen = lastSeenRef.current;
    lastSeenRef.current = { key: step.key, done: step.done };
    if (!seen || seen.key !== step.key || seen.done || !step.done) return;
    const advance = advanceAfterStep(model, selectedPhase, step.key);
    if (!advance) return;
    if (advance.kind === "next") {
      setSelectedStep(advance.key);
      return;
    }
    announcePhaseDone(selectedPhase, advance.nextPhase);
    setSelectedPhase(null);
    setSelectedStep(null);
  }, [model, selectedPhase, selectedStep, announcePhaseDone]);

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
        <RetiredBoardV3 model={model} orgId={orgId} context={context} />
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
  // successfully; hand back to the board with a confirmation once nothing is left in that
  // phase. Shares `advanceAfterStep` with the data-driven effect above so an explicit save
  // and an implicit completion behave identically.
  const handleStepDone = () => {
    if (!selectedPhase || !selectedStep) return;
    const advance = advanceAfterStep(model, selectedPhase, selectedStep);
    if (!advance) return;
    if (advance.kind === "next") {
      setSelectedStep(advance.key);
      return;
    }
    announcePhaseDone(selectedPhase, advance.nextPhase);
    handleCollapse();
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
    role === "producer" &&
    model.phases.some((phase) => visibleSteps(phase.steps).some((step) => !step.done && !step.actionableByViewer));
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
              onNext={handleStepDone}
              {...stepHeadingKeys(activeStep.key, model.datesSource)}
            >
              <StepBodyV3 step={activeStep} orgId={orgId} onDone={handleStepDone} onGoToStep={setSelectedStep} />
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
