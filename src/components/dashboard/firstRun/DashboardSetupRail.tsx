import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useCan } from "@/hooks/useCapabilities";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComposedStep, DashboardSetupRailProps, SetupBlock } from "@/lib/dashboard/types";

// One shared "hard/soft blocker" chip vocabulary, using the same `badgeVariants`
// tokens (risk = amber, neutral = muted) as the sibling `SetupStepRow`, so the same
// "Blocks X" concept renders identically across the Bookings and Dashboard rails.
const BLOCK_CHIP: Record<Exclude<SetupBlock, null>, { tone: "risk" | "neutral"; label: string }> = {
  offers: { tone: "risk", label: "Blocks offers" },
  filling: { tone: "neutral", label: "Blocks filling" },
  issuing: { tone: "risk", label: "Blocks issuing" },
};

function StepRow({ step, index }: { step: ComposedStep; index: number }) {
  // Hooks may not be conditional: always read the capability, ignore when the step has none.
  const allowed = useCan(step.ctaCapability ?? "");
  const canAct = !step.ctaCapability || allowed;
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
      {step.done ? (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      ) : (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground/70">{index}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{step.title}</div>
        <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{step.done ? step.doneHint : step.todoHint}</div>
        {!step.done && canAct && (
          <Link to={step.ctaRoute} className="mt-2 inline-block rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600">{step.ctaLabel}</Link>
        )}
      </div>
      {!step.done && step.block && (
        <span className={cn(badgeVariants({ variant: BLOCK_CHIP[step.block].tone }), "shrink-0 font-semibold")}>
          {BLOCK_CHIP[step.block].label}
        </span>
      )}
    </div>
  );
}

export function DashboardSetupRail({ eyebrow, title, body, complete, steps, rules, offFooters, onClose, onDismiss }: DashboardSetupRailProps) {
  return (
    <div className="w-[340px] shrink-0 overflow-hidden rounded-lg border-[0.5px] border-border bg-card shadow-elev3">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>
          <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">Close</button>
        </div>
        <div className="mt-1.5 font-display text-base font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs leading-[19px] text-muted-foreground text-pretty">{body}</p>
      </div>

      {complete ? (
        <div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500"><Check className="h-3 w-3 text-white" strokeWidth={3} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{r.title}</div>
                <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{r.hint}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>{steps.map((s, i) => <StepRow key={`${s.moduleKey}:${s.key}`} step={s} index={i + 1} />)}</div>
      )}

      <div className="flex items-center gap-2 px-3.5 py-3">
        <div className="flex-1 text-xs leading-[18px] text-muted-foreground/70 text-pretty">{offFooters.join(" ")}</div>
        {complete && (
          <button onClick={onDismiss} className="shrink-0 rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Got it</button>
        )}
      </div>
    </div>
  );
}
