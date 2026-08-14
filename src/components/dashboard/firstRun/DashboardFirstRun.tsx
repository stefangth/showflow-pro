// src/components/dashboard/firstRun/DashboardFirstRun.tsx
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { QueueRow, StageAction, StageChainResult } from "@/lib/dashboard/stageChain.types";
import type { FeatureKey } from "@/lib/entitlements";
import { DashboardChain } from "./DashboardChain";
import { DashboardWelcomeCollapsed } from "./DashboardWelcomeCollapsed";
import { FirstRunHeaderCard } from "./FirstRunHeaderCard";
import { FirstRunQueue } from "./FirstRunQueue";
import { FirstRunSideCard } from "./FirstRunSideCard";
import { OffFooters } from "./OffFooters";

/**
 * The dashboard first-run assembly: wires the pure `StageChainResult` composed by
 * `composeStageChain` (see src/lib/dashboard/stageChain.ts) into the Wave-B
 * presentational leaves, in the reproduction's render order. Owns exactly two pieces
 * of behavior neither leaf can: mapping a stage's `StageAction` to `navigate()` /
 * `onOpenSetup`, and the dismissed <-> collapsed-chip toggle.
 */
export function DashboardFirstRun(props: {
  result: StageChainResult;
  queueRows: QueueRow[];
  onOpenSetup: (feature: FeatureKey, step: string) => void;
  dismissed: boolean;
  onDismiss: () => void;
  onUndismiss: () => void;
  onGhost?: () => void;
}): JSX.Element {
  const { result, queueRows, onOpenSetup, dismissed, onDismiss, onUndismiss, onGhost } = props;
  const navigate = useNavigate();
  const { t } = useTranslation("dashboard");

  const handleAction = (action: StageAction) => {
    if (action.kind === "route") navigate(action.to);
    else onOpenSetup(action.feature, action.step);
  };

  if (dismissed) {
    return (
      <DashboardWelcomeCollapsed
        label={result.progressLabel}
        hint={t("firstRun.pickUpWhereLeftOff")}
        ctaLabel={t("firstRun.resume")}
        onOpen={onUndismiss}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("firstRun.hide")}
        </button>
      </div>

      <FirstRunHeaderCard
        eyebrow={result.eyebrow}
        headline={result.headline}
        body={result.body}
        ghost={result.ghost}
        hint={result.hint}
        progressLabel={result.progressLabel}
        progressHint={result.progressHint}
        hasSteps={result.hasSteps}
        ticks={result.ticks}
        modules={result.modules}
        onGhost={onGhost}
      />

      <OffFooters footers={result.offFooters} />

      {result.hasChain && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-[var(--text-faint)]">
              {result.chainTitle}
            </div>
            <div className="flex-1" />
            <div className="text-xs text-[var(--text-faint)]">{result.rulesBy}</div>
          </div>
          {/* Below xl the chain stacks vertically (full-width cards, no overflow). At xl
             it lays out as a row; this wrapper lets that row scroll horizontally if it
             ever exceeds the content width, so the page body never scrolls sideways. */}
          <div className="overflow-x-auto">
            <DashboardChain stages={result.stages} onAction={handleAction} />
          </div>
        </div>
      )}

      <FirstRunSideCard title={result.sideTitle} body={result.sideBody} links={result.side} />

      <FirstRunQueue
        title={result.queueTitle}
        hint={result.queueHint}
        sample={result.sample}
        opacity={result.queueOpacity}
        rows={queueRows}
      />
    </div>
  );
}
