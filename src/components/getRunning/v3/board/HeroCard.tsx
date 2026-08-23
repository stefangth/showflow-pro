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
  onSeeAll,
}: {
  model: GetRunningModelV3;
  onOpenNext: (phase: GetRunningPhaseKey, step: GetRunningStepKey) => void;
  /** Optional handler for the "See all steps" button, e.g. scrolling the all-steps card
   *  into view. Renders as a plain button with no behavior if omitted. */
  onSeeAll?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation("getRunningV3");
  const { nextStep } = model;
  if (!nextStep) return null;

  const remaining = model.totalCount - model.doneCount;
  const minutes = MINUTES_PER_STEP * remaining;
  const stepTitle = t(`steps.${nextStep.key}.title`);

  // Deliberate fixed-on-fixed surface: a permanently-white button on the fixed
  // `bg-accent-600` hero card (which stays the same hot violet in both themes).
  // `text-accent-700` is a fixed dark-violet stop, so it reads on white and on
  // the accent-50 hover in BOTH modes. This is the one legitimate exception to
  // the fixed-light-background lint rule, hence the explicit disable.
  // eslint-disable-next-line no-restricted-syntax -- fixed-on-fixed button, text is a fixed dark stop (see comment above)
  const openStepButtonClass = "bg-white text-accent-700 hover:bg-accent-50";

  return (
    <div
      data-testid="hero-card"
      className="rounded-[var(--radius-xl)] bg-accent-600 p-5 shadow-elev3"
    >
      <Eyebrow tone="accent" className="text-white">{t("hero.eyebrowTemplate")}</Eyebrow>
      <h2 className="mt-2 max-w-[560px] text-display-sm font-semibold leading-[34px] tracking-[-0.4px] text-white text-pretty">
        {stepTitle}
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className={openStepButtonClass}
          onClick={() => onOpenNext(nextStep.phase, nextStep.key)}
        >
          {t("hero.openStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={onSeeAll}
          className="rounded-m border border-white/40 px-3 py-1.5 text-control font-medium text-white hover:border-white/60"
        >
          {t("hero.seeAll")}
        </button>
        <div className="flex-1" />
        <Metric size="body" className="text-accent-50">
          {t("hero.minutes", { minutes })}
        </Metric>
      </div>
    </div>
  );
}
