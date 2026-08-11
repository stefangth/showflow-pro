// src/components/dashboard/firstRun/DashboardChain.tsx
import type { Stage, StageAction } from "@/lib/dashboard/stageChain.types";
import { StageCard } from "./StageCard";

/** The stage-chain strip of StageCards. Each StageCard draws its own leading arrow
 *  (when stage.n !== "01"), pointing down while stacked and right once the row lays
 *  out. Below `xl` the cards stack vertically so a narrow viewport reads them full
 *  width top-to-bottom instead of squishing four columns into slivers; at `xl` they
 *  return to the horizontal Dates -> Offers -> Confirm -> Hire order flow. */
export function DashboardChain({ stages, onAction }: { stages: Stage[]; onAction: (action: StageAction) => void }) {
  return (
    <div className="flex flex-col gap-0 xl:flex-row xl:items-stretch">
      {stages.map((stage) => (
        <StageCard key={stage.key} stage={stage} onAction={onAction} />
      ))}
    </div>
  );
}
