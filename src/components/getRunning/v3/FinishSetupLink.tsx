import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";
import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";
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
 * Split into an outer gate + inner component so a v3-disabled org never pays for
 * `useGetRunningV3()` — which composes the whole board model, including the entire
 * `useAirtableConsole` query fan-out. Since the v3 cutover, v3-on is the default, so the
 * orgs this spares are those with an explicit `getrunning_v3_enabled = false` override plus
 * the brief flag-loading window (the outer gate returns null while `isLoading`). The outer
 * component only calls the cheap `useGetRunningV3Enabled()` flag check; the inner component,
 * which calls the heavy hook, is not rendered (and its hooks not evaluated) until the flag
 * says v3 is live for this org. This keeps the conditional strictly at the component-render
 * level, not inside a single component's hook order.
 */
export function FinishSetupLink({ steps }: { steps: GetRunningStepKey[] }) {
  const { enabled, isLoading } = useGetRunningV3Enabled();

  if (!enabled || isLoading) return null;

  return <FinishSetupLinkInner steps={steps} />;
}

/**
 * Renders nothing while the live model is still loading, or when none of the candidates are
 * actionable for this viewer right now (`pickFinishStep` returns null) — including the steady
 * state where everything in `steps` is already done, so the affordance disappears on its own
 * rather than linking to a board with nothing left to do.
 */
function FinishSetupLinkInner({ steps }: { steps: GetRunningStepKey[] }) {
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
