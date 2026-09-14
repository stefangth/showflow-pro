import { useTranslation } from "react-i18next";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusPill } from "@/components/ui/status-pill";
import { visibleSteps } from "@/lib/getRunning/steps";
import type { GetRunningModelV3 } from "@/lib/getRunning/steps";

/**
 * "What is still shut": the two things a brand-new org actually cares about (can I ask an
 * artist yet, can I issue a contract yet), each gated behind whatever steps still block it
 * — never the raw 17-step checklist. Reads `canFirstOffer` and each step's own `block`
 * straight off the model rather than re-deriving anything: "first ask" is shut while any
 * `offers`/`booking`-blocking step is outstanding, "first contract" is shut while any
 * `issuing`-blocking step is outstanding (the paperwork phase's letterhead/terms/
 * countersign). Once neither gate is shut, the card collapses to one reassuring line
 * rather than two empty rows.
 */
export function StillShutCard({ model }: { model: GetRunningModelV3 }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const allSteps = model.phases.flatMap((p) => visibleSteps(p.steps));

  const firstAskCount = allSteps.filter(
    (s) => !s.done && (s.block === "offers" || s.block === "booking"),
  ).length;
  const firstContractCount = allSteps.filter((s) => !s.done && s.block === "issuing").length;

  const nothingShut = firstAskCount === 0 && firstContractCount === 0;

  return (
    <div data-testid="still-shut-card" className="rounded-card border border-border bg-card p-4">
      <Eyebrow>{t("stillShut.title")}</Eyebrow>
      <div className="mt-3 flex flex-col gap-2.5">
        {firstAskCount > 0 && (
          <div className="flex items-center gap-2.5">
            <p className="min-w-0 flex-1 text-control text-foreground">{t("stillShut.firstAsk")}</p>
            <StatusPill tone="waiting">{t("stillShut.stepsAway", { count: firstAskCount })}</StatusPill>
          </div>
        )}
        {firstContractCount > 0 && (
          <div className="flex items-center gap-2.5">
            <p className="min-w-0 flex-1 text-control text-foreground">{t("stillShut.firstContract")}</p>
            <StatusPill tone="waiting">{t("stillShut.stepsAway", { count: firstContractCount })}</StatusPill>
          </div>
        )}
        {nothingShut && (
          <p className="text-control text-muted-foreground">{t("stillShut.nothingElse")}</p>
        )}
      </div>
    </div>
  );
}
