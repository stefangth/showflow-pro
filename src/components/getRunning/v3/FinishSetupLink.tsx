import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { visibleSteps, type GetRunningModelV3, type GetRunningStepKey } from "@/lib/getRunning/steps";

/**
 * Pure pick: the first key in `candidates` (order matters, it is the caller's priority)
 * that names a currently visible step on `model` which is not done and the viewer can act
 * on. Returns `null` when nothing in the list qualifies (every candidate is done, hidden by
 * a source choice, or not actionable by this viewer's role/capability).
 *
 * Split out from the component so it can be unit-tested against a hand-built model instead
 * of seeding the whole `useGetRunningV3` live-data fixture (booking/hire/skills/dates-source
 * reads) per test case.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, not a component; kept beside the FinishSetupLink it backs for testability.
export function pickFinishStep(model: GetRunningModelV3, candidates: GetRunningStepKey[]): GetRunningStepKey | null {
  const steps = model.phases.flatMap((phase) => visibleSteps(phase.steps));
  for (const key of candidates) {
    const step = steps.find((s) => s.key === key);
    if (step && !step.done && step.actionableByViewer) return step.key;
  }
  return null;
}

/**
 * Small "Finish setup" affordance for a page header (Task C4 wires it into the four pages
 * that need it): given a list of candidate step keys relevant to that page, deep-links into
 * the v3 `/get-running` board (`?step=<key>`, the same param `GetRunningBoardV3` already
 * reads to auto-open a step) at the first one that is still outstanding for the viewer.
 *
 * Renders nothing while the live model is still loading, or when none of the candidates are
 * actionable for this viewer right now (`pickFinishStep` returns null) — including the steady
 * state where everything in `steps` is already done, so the affordance disappears on its own
 * rather than linking to a board with nothing left to do.
 *
 * Previously split into an outer `useGetRunningV3Enabled()` gate + this inner component, so a
 * v3-disabled org never paid for `useGetRunningV3()` (the whole board-model composition,
 * including the `useAirtableConsole` query fan-out). With the v3 cutover making v3
 * unconditional, that gate is always on, so it was dropped: this component now calls the
 * live model hook directly.
 */
export function FinishSetupLink({ steps }: { steps: GetRunningStepKey[] }) {
  const { t } = useTranslation("getRunningV3");
  const { model, isLoading } = useGetRunningV3();

  if (isLoading || !model) return null;

  const stepKey = pickFinishStep(model, steps);
  if (!stepKey) return null;

  return (
    <Button asChild variant="outline" size="sm">
      <Link to={`${ROUTES.GET_RUNNING}?step=${stepKey}`}>
        {t("finishSetup.label", { step: t(`steps.${stepKey}.title`) })}
      </Link>
    </Button>
  );
}
