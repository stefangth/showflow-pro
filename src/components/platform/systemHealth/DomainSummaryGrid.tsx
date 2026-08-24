import { StatusDot } from "@/components/ui/status-dot";
import { healthTone, type HealthState } from "@/lib/systemHealth";

export interface DomainSummary { key: string; label: string; state: HealthState; detail: string }

/** Domains planned for later phases — shown muted so we never imply unmeasured health. */
const PLACEHOLDERS = ["Database", "Org sync", "Auth / Storage"];

export function DomainSummaryGrid({ domains }: { domains: DomainSummary[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
      {domains.map((d) => (
        <div key={d.key} className="rounded-card bg-well-tint p-3">
          <div className="mb-2 flex items-center gap-2">
            <StatusDot tone={healthTone(d.state)} />
            <span className="text-sm text-muted-foreground">{d.label}</span>
          </div>
          <div className="text-xs text-muted-foreground">{d.detail}</div>
        </div>
      ))}
      {PLACEHOLDERS.map((label) => (
        <div key={label} className="rounded-card bg-well-tint p-3 opacity-60">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
          <div className="text-xs text-muted-foreground">Not monitored yet</div>
        </div>
      ))}
    </div>
  );
}
