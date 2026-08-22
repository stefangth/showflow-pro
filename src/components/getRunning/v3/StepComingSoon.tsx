import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Eyebrow } from "@/components/ui/eyebrow";
import { stepFeatureLink } from "@/lib/getRunning/stepFeature";
import type { GetRunningStep } from "@/lib/getRunning/steps";

/**
 * Stand-in body for every Phase-1 placeholder step (`source`/`connect`/`map`/`cities`/
 * `productions`/`skills`/`fee`/`document` — see `stepRegistryV3.tsx`). These steps'
 * Phase-1 signals are honest approximations (see `src/lib/getRunning/steps.ts`'s header
 * comment) and their real in-panel editors are a Phase 2+ scope, so rather than fake a
 * body this just says so plainly and deep-links to the step's real home
 * (`stepFeatureLink`) via the same `guide.<key>.article` copy `WizardShell`'s own right
 * rail already uses for that link, so the two never say different things about where a
 * step actually lives.
 */
export function StepComingSoon({ step }: { step: GetRunningStep }): JSX.Element {
  const { t } = useTranslation("getRunningV3");

  return (
    <div className="flex flex-col items-start gap-2 rounded-l border border-dashed border-border px-4 py-6">
      <Eyebrow>{t("comingSoon.title")}</Eyebrow>
      <p className="text-xs leading-[17px] text-muted-foreground">{t("comingSoon.body")}</p>
      <Link
        to={stepFeatureLink(step.key)}
        className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
      >
        {t(`guide.${step.key}.article`)}
      </Link>
    </div>
  );
}
