import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useCan } from "@/hooks/useCapabilities";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComposedStep, DashboardSetupRailProps } from "@/lib/dashboard/types";
// The one "Blocks X" vocabulary, shared with BookingSetupRail: this rail and that one
// render the SAME step to the same viewer, and each used to hold its own copy of the map.
import { SETUP_BLOCK_CHIPS } from "@/lib/dashboard/setupBlocks";

function StepRow({ step, index, onAction }: { step: ComposedStep; index: number; onAction?: (step: ComposedStep) => void }) {
  // Hooks may not be conditional: always read the capability, ignore when the step has none.
  const allowed = useCan(step.ctaCapability ?? "");
  const canAct = !step.ctaCapability || allowed;
  // One CTA look shared by the in-place button and the route-out Link fallback.
  const ctaClass = "mt-2 inline-block rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-600";
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
      {step.done ? (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
        </span>
      ) : (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground/70">{index}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{step.title}</div>
        <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{step.done ? step.doneHint : step.todoHint}</div>
        {!step.done && canAct && (
          onAction
            ? <button type="button" onClick={() => onAction(step)} className={ctaClass}>{step.ctaLabel}</button>
            : <Link to={step.ctaRoute} className={ctaClass}>{step.ctaLabel}</Link>
        )}
      </div>
      {!step.done && step.block && (
        <span className={cn(badgeVariants({ variant: SETUP_BLOCK_CHIPS[step.block].tone }), "shrink-0 font-semibold")}>
          {SETUP_BLOCK_CHIPS[step.block].label}
        </span>
      )}
    </div>
  );
}

/** Banner-layout only: the segmented progress rail, rendered inside the violet hero
 *  header, so it mirrors the dashboard welcome card's white-on-accent progress exactly. */
function ProgressCluster({ label, filled, total, hint }: { label?: string; filled?: number; total?: number; hint?: string }) {
  if (!total) return null;
  return (
    <div className="shrink-0 text-right">
      {label && <div className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/60">{label}</div>}
      <div className="mt-2 flex justify-end gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`h-[3px] w-[34px] rounded-full ${i < (filled ?? 0) ? "bg-primary-foreground/90" : "bg-primary-foreground/25"}`} />
        ))}
      </div>
      {hint && <div className="mt-2 text-xs text-primary-foreground/60">{hint}</div>}
    </div>
  );
}

export function DashboardSetupRail({
  eyebrow, title, body, complete, steps, rules, offFooters, onClose, onDismiss,
  layout = "rail", onStepAction, progressLabel, progressFilled, progressTotal, progressHint,
}: DashboardSetupRailProps) {
  const banner = layout === "banner";
  return (
    <div className={cn(
      "overflow-hidden rounded-lg border-[0.5px] border-border bg-card shadow-elev3",
      banner ? "w-full" : "w-full md:w-[340px] md:shrink-0 order-first md:order-none",
    )}>
      {banner ? (
        // Violet hero, mirroring DashboardWelcome (bg-accent-500 + primary-foreground),
        // so the module rail's top reads as the same hero as the dashboard welcome card.
        <div className="flex flex-col gap-4 bg-accent-500 p-5 text-primary-foreground sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0 order-2 sm:order-none">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/60">{eyebrow}</div>
            <div className="mt-2 font-display text-xl font-semibold leading-tight tracking-tight text-primary-foreground text-pretty">{title}</div>
            <p className="mt-1.5 text-sm leading-[21px] text-primary-foreground/80 text-pretty">{body}</p>
          </div>
          <div className="order-1 flex flex-row-reverse items-center justify-between gap-3 sm:order-none sm:flex-col sm:items-end">
            <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-primary-foreground/80 hover:bg-primary-foreground/10">Hide</button>
            <ProgressCluster label={progressLabel} filled={progressFilled} total={progressTotal} hint={progressHint} />
          </div>
        </div>
      ) : (
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>
            <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">Close</button>
          </div>
          <div className="mt-1.5 font-display text-base font-semibold text-foreground">{title}</div>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground text-pretty">{body}</p>
        </div>
      )}

      {complete ? (
        <div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500"><Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{r.title}</div>
                <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{r.hint}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>{steps.map((s, i) => <StepRow key={`${s.moduleKey}:${s.key}`} step={s} index={i + 1} onAction={onStepAction} />)}</div>
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
