import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { StatusDot } from "@/components/ui/status-dot";
import { ROUTES } from "@/config/app.config";
import type { GetRunningStep, GetRunningStepKey, GetRunningPhaseKey } from "@/lib/getRunning/steps";
import { stepFeatureLink } from "@/lib/getRunning/stepFeature";
import { WizardFooterContext } from "./WizardFooterContext";

const PHASE_ORDER: GetRunningPhaseKey[] = ["get_dates", "bookable", "paperwork"];

export interface WizardShellProps {
  phaseKey: GetRunningPhaseKey;
  steps: GetRunningStep[]; // the phase's steps, for the left rail
  activeKey: GetRunningStepKey; // which step body shows
  onSelectStep: (key: GetRunningStepKey) => void;
  onCollapse: () => void; // header "Collapse"/close and footer "Finish later"
  children: React.ReactNode; // the step body (from stepRegistryV3)
}

/** Left rail dot: filled with a check-shaped dot for done, a solid accent dot for the
 *  current step, and a hollow ring for a pending one. Mirrors the `TONES`-driven dot
 *  vocabulary the rest of the board uses rather than inventing a fourth marker shape. */
function StepDot({ done, current }: { done: boolean; current: boolean }): JSX.Element {
  if (done) {
    return <StatusDot tone="confirmed" />;
  }
  if (current) {
    return <StatusDot tone="accent" />;
  }
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-xs border border-border" aria-hidden="true" />;
}

/**
 * The v3 wizard shell (Task 6): the one reusable frame every /get-running phase expands
 * into. An accent header band (phase number pill, phase name, a block chip for the active
 * step, the step counter, and Collapse), a three-column body grid (left step rail, middle
 * `children`, right "How this works" guide for the active step), and a sticky footer
 * (step counter, a note, "Finish later", and the footer-portal mount other components can
 * consume via `WizardFooterContext`, mirroring `TaskPanel`'s `TaskPanelFooterContext`).
 */
export function WizardShell({
  phaseKey,
  steps: incomingSteps,
  activeKey,
  onSelectStep,
  onCollapse,
  children,
}: WizardShellProps): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const [footerSlotEl, setFooterSlotEl] = useState<HTMLDivElement | null>(null);

  // Defensive: the board is expected to pass only visible (non-`hidden`) steps, but this
  // filter is a cheap, single-purpose backstop so the rail/counter stay correct here too
  // if a future caller ever forgets to filter upstream.
  const steps = useMemo(() => incomingSteps.filter((step) => !step.hidden), [incomingSteps]);

  const activeIndex = useMemo(() => steps.findIndex((step) => step.key === activeKey), [steps, activeKey]);
  const activeStep: GetRunningStep | undefined = activeIndex >= 0 ? steps[activeIndex] : steps[0];
  const stepNumber = activeIndex >= 0 ? activeIndex + 1 : 1;
  const totalSteps = steps.length;
  const phaseOrder = PHASE_ORDER.indexOf(phaseKey) + 1;
  // The header counter renders a bare "N / M" (through <Metric>, numbers are always Metric
  // per the design system) with the localized sentence attached only via aria-label so
  // assistive tech still hears a real sentence rather than a slash-separated pair of digits.
  const stepOfLabel = t("wizard.stepOf", { step: stepNumber, total: totalSteps });
  const stepCounter = `${stepNumber} / ${totalSteps}`;

  // Per the design, a red "blocks your first ask" chip means the step gates the FIRST offer:
  // that's true for the get_dates phase (block: "booking", nothing can be offered until dates
  // exist) and the bookable phase's own offers-blocking steps (block: "offers"). The
  // paperwork/contracts phase (block: "issuing"/"filling"/null) never renders this red chip —
  // contracts are never "blocking the first ask", only "not yet finished" — so those steps
  // fall through to the neutral admin-only chip below instead.
  const blocksFirstAsk = activeStep?.block === "offers" || activeStep?.block === "booking";

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-l border border-border bg-card shadow-elev2">
      {/* Header band. Uses the semantic `bg-accent` / `text-accent-foreground` pair
          (mode-aware: light-violet band + accent-600 text in light, accent-900 band +
          accent-100 text in dark) rather than the fixed `bg-accent-50` scale stop, whose
          hex never flips and would leave light `text-foreground` unreadable in dark. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-accent px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Metric size="inline" className="text-primary-foreground">
            {phaseOrder}
          </Metric>
        </span>
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-accent-foreground">
          {t(`phases.${phaseKey}.name`)}
        </div>
        {blocksFirstAsk && <StatusPill tone="risk">{t("wizard.blocksFirstAsk")}</StatusPill>}
        {activeStep?.adminOnly && <StatusPill tone="neutral">{t("wizard.adminOnly")}</StatusPill>}
        {activeStep && !activeStep.actionableByViewer && (
          <StatusPill tone="waiting">{t("wizard.waitsOnAdmin")}</StatusPill>
        )}
        <div className="flex-1" />
        <span aria-label={stepOfLabel} className="text-control text-muted-foreground">
          <Metric size="body">{stepCounter}</Metric>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onCollapse}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t("wizard.collapse")}
        </Button>
      </div>

      {/* Body. Single column below `lg` (the fixed 216px rail + 268px guide only leave
          room for the fluid middle on a wide viewport); the three fixed/fluid columns
          come back at `lg`. When stacked, the rail/guide switch their side borders for
          bottom/top borders so the seams still read. */}
      <div className="grid grid-cols-1 items-start gap-0 lg:grid-cols-[216px_minmax(0,1fr)_268px]">
        {/* Left: step rail */}
        <nav
          aria-label={t("wizard.stepsNav")}
          className="flex flex-col gap-0.5 border-b border-border p-3 lg:border-b-0 lg:border-r"
        >
          {steps.map((step) => {
            const isActive = step.key === activeKey;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => onSelectStep(step.key)}
                aria-current={isActive ? "step" : undefined}
                className={`flex items-start gap-2 rounded-s px-2 py-1.5 text-left transition-colors ${
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover-tint"
                }`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-start gap-2">
                    {/* The dot sits in a box exactly one title-line tall (h-[1lh] at the
                        title's text-control size) and is centered within it, so it lands on
                        the center of the FIRST line even when the title wraps to two lines,
                        rather than centering on the whole block or being top-nudged by a
                        hardcoded margin. */}
                    <span className="flex h-[1lh] shrink-0 items-center text-control">
                      <StepDot done={step.done} current={isActive} />
                    </span>
                    <span className="text-control font-medium">{t(`steps.${step.key}.title`)}</span>
                  </span>
                  {/* Second line, indented past the dot (1.5) + gap (2) = pl-3.5 to stay
                      aligned under the title. */}
                  <span className="pl-3.5 text-xs text-muted-foreground">{t(`steps.${step.key}.hint`)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Middle: step body. Wrapped in the footer-portal context so a step body can
            portal its own primary action into the footer slot below (mirrors
            `TaskPanel`'s `TaskPanelFooterContext` pattern). */}
        <div className="min-w-0 p-4">
          <WizardFooterContext.Provider value={footerSlotEl}>{children}</WizardFooterContext.Provider>
        </div>

        {/* Right: how this works guide */}
        {activeStep && (
          <aside className="flex flex-col gap-2 border-t border-border p-4 lg:border-t-0 lg:border-l">
            <Eyebrow>{t("wizard.howThisWorks")}</Eyebrow>
            <div className="text-control font-semibold text-foreground">
              {t(`guide.${activeStep.key}.title`)}
            </div>
            <p className="text-xs leading-[17px] text-muted-foreground">{t(`guide.${activeStep.key}.body`)}</p>
            <ul className="flex flex-col gap-1 pl-4 text-xs leading-[17px] text-muted-foreground">
              {(t(`guide.${activeStep.key}.points`, { returnObjects: true }) as string[]).map((point) => (
                <li key={point} className="list-disc">
                  {point}
                </li>
              ))}
            </ul>
            <Link
              to={stepFeatureLink(activeStep.key)}
              className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
            >
              {t(`guide.${activeStep.key}.article`)}
            </Link>
            <Link to={ROUTES.HELP} className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline">
              {t("wizard.helpCenter")}
            </Link>
          </aside>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2.5 border-t border-border bg-well-tint px-4 py-3.5">
        {/* Same "step N of M" fact as the header counter, worded as a full sentence here
            (distinct visible text from the header's bare "N / M") but with the numbers
            still routed through <Metric> (Geist Mono, tabular) per the numbers-are-Metric
            rule, exactly like the header counter. */}
        <span className="text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="wizard.stepOfRich"
            values={{ step: stepNumber, total: totalSteps }}
            components={[
              <Metric key="step" size="inline">
                {""}
              </Metric>,
              <Metric key="total" size="inline">
                {""}
              </Metric>,
            ]}
          />
        </span>
        <span className="text-xs text-muted-foreground">{t("wizard.footerNote")}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCollapse}>
            {t("wizard.finishLater")}
          </Button>
          <div ref={setFooterSlotEl} className="flex items-center gap-2" />
        </div>
      </div>
    </div>
  );
}
