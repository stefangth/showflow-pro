import { Trans, useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Metric } from "@/components/ui/metric";
import { TONES } from "@/components/ui/tones";
import type { GetRunningModelV3, GetRunningPhaseKey, GetRunningPhaseV3 } from "@/lib/getRunning/steps";

/**
 * One numbered row in the phase list below the "All N steps" card: order number, phase
 * name, a `k of n done` status line, and a right-side status marker.
 *
 * The WHOLE row is the trigger that (re)opens the phase's wizard — clicking anywhere on
 * the bar calls `onOpen`, mirroring the whole-row-clickable step rail inside the wizard.
 * That covers reopening a phase you already finished, not just starting an unfinished one.
 * The one exception is a phase that `waitsOn` an earlier phase not yet clear: it is not
 * actionable until that phase gives it up, so it renders as an inert row (no click, no
 * focus) showing a plain "Waits on {phase}" line. Openable rows show a `Start`/`Continue`
 * action word (untouched vs in-progress) or, when the phase is fully done, a filled check
 * (mirroring `PhaseCard`'s `complete` treatment in v1) — the check is a status marker, not
 * a second control; the surrounding row is still what reopens it.
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

  const number = (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
      <Metric size="inline">{index}</Metric>
    </span>
  );

  const body = (
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
  );

  // Locked: waits on an earlier phase. Inert row, not a button — nothing to open yet.
  if (phase.waitsOn) {
    return (
      <div
        data-testid={`phase-row-${phase.key}`}
        className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
      >
        {number}
        {body}
        <span className="shrink-0 text-control text-muted-foreground">
          {t("phaseRow.waitsOn", { name: waitingOnPhase ? t(`phases.${waitingOnPhase.key}.name`) : phase.waitsOn })}
        </span>
      </div>
    );
  }

  // Openable (untouched, in-progress, or already done): the whole bar reopens the wizard.
  return (
    <button
      type="button"
      data-testid={`phase-row-${phase.key}`}
      onClick={() => onOpen(phase.key)}
      className="flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-hover-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {number}
      {body}
      {phase.done ? (
        // Green, like the step dots and the phase icon rail. Accent violet here read as
        // "selected" next to a rail that had just turned green for the same fact.
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONES.confirmed.bg} ${TONES.confirmed.fg}`}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span className="shrink-0 text-control font-medium text-accent-text">
          {phase.doneCount > 0 ? t("phaseRow.continue") : t("phaseRow.start")}
        </span>
      )}
    </button>
  );
}
