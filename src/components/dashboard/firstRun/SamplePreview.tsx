// src/components/dashboard/firstRun/SamplePreview.tsx
import type { SamplePreviewProps, SampleQueueRow } from "@/lib/dashboard/types";

const DOT: Record<SampleQueueRow["tone"], string> = {
  accent: "bg-accent-500", warning: "bg-warning", faint: "bg-muted-foreground/40",
};

export function SamplePreview({ complete, sample, sectionTitle, sectionHint, children }: SamplePreviewProps) {
  // Show the greyed sample only when setup is incomplete AND a sample fixture was
  // supplied. A surface with no fixture (the artist body) always renders its children.
  return (
    <div className="flex flex-col gap-4">
      {!complete && sample && (
        <div className="flex items-center gap-2">
          <div className="font-display text-[17px] font-semibold tracking-tight text-foreground">{sectionTitle}</div>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Sample</span>
          <span className="flex-1" />
          <div className="text-xs text-muted-foreground/70">{sectionHint}</div>
        </div>
      )}

      {!complete && sample ? (
        <div className="flex flex-col gap-4 opacity-[.55]" aria-hidden>
          <div className="flex gap-3">
            {sample.stats.map((s) => (
              <div key={s.title} className="flex-1 rounded-lg border-[0.5px] border-border bg-card p-3.5">
                <div className="text-xs font-medium text-muted-foreground">{s.title}</div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <div className="font-mono text-[28px] font-semibold tracking-tight text-foreground">{s.value}</div>
                  <div className="text-xs text-muted-foreground/70">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Today</div>
            {sample.queue.map((q) => (
              <div key={q.title} className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className={`h-1.5 w-1.5 rounded-sm ${DOT[q.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{q.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{q.hint}</div>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{q.when}</div>
                <span className="rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground">{q.cta}</span>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Next 7 days</div>
            {sample.week.map((w) => (
              <div key={w.date} className="grid grid-cols-[112px_1fr_190px] items-center gap-3 border-b border-border px-4 py-2.5">
                <div className="font-mono text-xs text-foreground">{w.date}</div>
                <div className="text-[13px] text-foreground">{w.ref}</div>
                <div className="text-right text-xs text-muted-foreground">{w.status}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
