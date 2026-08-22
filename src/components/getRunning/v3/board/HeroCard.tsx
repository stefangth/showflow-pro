import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import type { GetRunningModelV3, GetRunningPhaseKey, GetRunningStepKey } from "@/lib/getRunning/steps";
import { MINUTES_PER_STEP } from "@/lib/getRunning/steps";

/**
 * The accent hero card for the v3 `/get-running` board: "Where you left off" plus the
 * single next step, in display type, so there is always exactly one obvious next action
 * rather than a wall of rows to triage. Renders nothing (a plain `null`) once
 * `model.nextStep` is empty (the whole board is done) — `GetRunningBoardV3` (Task 9) is
 * responsible for swapping in the retired/complete state at that point, this card never
 * renders its own empty variant.
 */
export function HeroCard({
  model,
  onOpenNext,
}: {
  model: GetRunningModelV3;
  onOpenNext: (phase: GetRunningPhaseKey, step: GetRunningStepKey) => void;
}): JSX.Element | null {
  const { t } = useTranslation("getRunningV3");
  const { nextStep } = model;
  if (!nextStep) return null;

  const remaining = model.totalCount - model.doneCount;
  const minutes = MINUTES_PER_STEP * remaining;
  const stepTitle = t(`steps.${nextStep.key}.title`);

  return (
    <div
      data-testid="hero-card"
      className="rounded-l border border-accent-200 bg-accent-50 p-5 shadow-elev2"
    >
      <Eyebrow tone="accent">{t("hero.eyebrowTemplate")}</Eyebrow>
      <h2 className="mt-2 max-w-[560px] text-display-sm font-semibold leading-[34px] tracking-[-0.4px] text-foreground text-pretty">
        {stepTitle}
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => onOpenNext(nextStep.phase, nextStep.key)}>
          {t("hero.openStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <button type="button" className="text-control font-medium text-accent-600 hover:text-accent-700">
          {t("hero.seeAll")}
        </button>
        <div className="flex-1" />
        <Metric size="body" className="text-muted-foreground">
          {t("hero.minutes", { minutes })}
        </Metric>
      </div>
    </div>
  );
}
