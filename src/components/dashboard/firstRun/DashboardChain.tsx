// src/components/dashboard/firstRun/DashboardChain.tsx
import type { Stage, StageAction } from "@/lib/dashboard/stageChain.types";
import { StageCard } from "./StageCard";

/** The stage-chain row: a horizontally-scrollable strip of StageCards. Each StageCard
 *  draws its own leading arrow (when stage.n !== "01"), so this component just lays
 *  the stages out flex-in-a-row, matching the reproduction's single flex wrapper. */
export function DashboardChain({ stages, onAction }: { stages: Stage[]; onAction: (action: StageAction) => void }) {
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto">
      {stages.map((stage) => (
        <StageCard key={stage.key} stage={stage} onAction={onAction} />
      ))}
    </div>
  );
}
