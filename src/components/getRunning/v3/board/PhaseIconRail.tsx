import { useTranslation } from "react-i18next";
import {
  Search,
  Zap,
  Filter,
  MapPin,
  Ticket,
  User,
  Music,
  Users,
  Route,
  Clock,
  Plus,
  Settings,
  DollarSign,
  MoreHorizontal,
  Calendar,
  Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Metric } from "@/components/ui/metric";
import { TONES } from "@/components/ui/tones";
import type { GetRunningPhaseV3, GetRunningStepKey } from "@/lib/getRunning/steps";

/** One icon per step key, matching the design's per-step glyph choice. Kept local to this
 *  rail rather than in `steps.ts` (which stays UI-free) or a shared registry, since nothing
 *  else in the v3 board needs a step icon. */
const STEP_ICON: Record<GetRunningStepKey, LucideIcon> = {
  source: Search,
  connect: Zap,
  map: Filter,
  cities: MapPin,
  productions: Ticket,
  artists: User,
  skills: Music,
  coverage: Users,
  flow: Route,
  timing: Clock,
  team: Plus,
  letterhead: Settings,
  fee: DollarSign,
  terms: MoreHorizontal,
  document: Calendar,
  countersign: Check,
};

/**
 * One rail of a phase's steps: an icon per step (filled once done, amber while it blocks
 * something and is still outstanding, a plain outline otherwise), plus the phase name,
 * a `k / n` counter and its one-line summary. Sits beside its two sibling rails in the
 * "All N steps" card (`GetRunningBoardV3`, Task 9); this component only ever renders one.
 */
export function PhaseIconRail({
  phase,
  onOpenStep,
}: {
  phase: GetRunningPhaseV3;
  onOpenStep: (key: GetRunningStepKey) => void;
}): JSX.Element {
  const { t } = useTranslation("getRunningV3");

  return (
    <div
      data-testid={`phase-icon-rail-${phase.key}`}
      className="min-w-0 flex-1 rounded-l border border-border bg-card p-3.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-control font-semibold text-foreground">{t(`phases.${phase.key}.name`)}</div>
        <div className="shrink-0 text-muted-foreground">
          <Metric size="inline">
            {phase.doneCount} / {phase.totalCount}
          </Metric>
        </div>
      </div>
      <p className="mt-1 text-xs leading-[17px] text-muted-foreground">{t(`phases.${phase.key}.summary`)}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {phase.steps.map((step) => {
          const Icon = STEP_ICON[step.key];
          const blocking = !step.done && step.block !== null;
          return (
            <button
              key={step.key}
              type="button"
              title={t(`steps.${step.key}.title`)}
              onClick={() => onOpenStep(step.key)}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-s border",
                step.done && "border-transparent bg-primary text-primary-foreground",
                !step.done && blocking && `border-transparent ${TONES.waiting.bg} ${TONES.waiting.fg}`,
                !step.done && !blocking && "border-border bg-transparent text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
