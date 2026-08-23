import { Trans, useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import type { GetRunningModelV3, GetRunningPhaseKey, GetRunningPhaseV3 } from "@/lib/getRunning/steps";

/**
 * One numbered row in the phase list below the "All N steps" card: order number, phase
 * name, a `k of n done` status line, and a right-side action. The action is either a plain
 * "Waits on {phase}" line (when `phase.waitsOn` names an earlier phase not yet clear — the
 * row is not actionable until that phase gives it up), or a `Continue`/`Start` button
 * (in-progress vs untouched). A fully done phase gets a filled check instead of a button,
 * mirroring `PhaseCard`'s `complete` treatment in v1.
 */
export function PhaseRow({
  phase,
  index,
  model,
  onOpen,
}: {
  phase: GetRunningPhaseV3;
  index: number;
  model: GetRunningModelV3;
  onOpen: (phase: GetRunningPhaseKey) => void;
}): JSX.Element {
  const { t } = useTranslation("getRunningV3");

  const waitingOnPhase = phase.waitsOn ? model.phases.find((p) => p.key === phase.waitsOn) : null;

  return (
    <div
      data-testid={`phase-row-${phase.key}`}
      className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
        <Metric size="inline">{index}</Metric>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-control font-semibold text-foreground">{t(`phases.${phase.key}.name`)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {/* Numbers-are-Metric (CLAUDE.md rule 8): the "{{done}} of {{total}} done" sentence
              routes its two interpolated numbers through <Metric>, via the same Trans+Metric
              idiom WizardShell's footer counter uses for embedding numbers inside a
              translated sentence. `doneOfRich` mirrors `wizard.stepOfRich`'s <0>/<1> shape;
              `phaseRow.doneOf` (plain) stays as the aria-label so assistive tech still hears
              a whole sentence rather than two separate number nodes. */}
          <span aria-label={t("phaseRow.doneOf", { done: phase.doneCount, total: phase.totalCount })}>
            <Trans
              t={t}
              i18nKey="phaseRow.doneOfRich"
              values={{ done: phase.doneCount, total: phase.totalCount }}
              components={[
                <Metric key="done" size="inline">
                  {""}
                </Metric>,
                <Metric key="total" size="inline">
                  {""}
                </Metric>,
              ]}
            />
          </span>
        </div>
      </div>
      {phase.waitsOn ? (
        <span className="shrink-0 text-control text-muted-foreground">
          {t("phaseRow.waitsOn", { name: waitingOnPhase ? t(`phases.${waitingOnPhase.key}.name`) : phase.waitsOn })}
        </span>
      ) : phase.done ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : (
        <Button type="button" variant={phase.doneCount > 0 ? "default" : "outline"} size="sm" onClick={() => onOpen(phase.key)}>
          {phase.doneCount > 0 ? t("phaseRow.continue") : t("phaseRow.start")}
        </Button>
      )}
    </div>
  );
}
