// src/components/dashboard/firstRun/FirstRunQueue.tsx
import type { QueueRow } from "@/lib/dashboard/stageChain.types";

/** The dashboard first-run queue: a header row (title, an optional "Sample"
 *  pill, and a hint) above a bordered row list. Mirrors the queue block in
 *  docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html —
 *  including the whole-list opacity used to grey out sample data. */
export function FirstRunQueue(props: {
  title: string;
  hint: string;
  sample: boolean;
  opacity: number;
  rows: QueueRow[];
}): JSX.Element {
  const { title, hint, sample, opacity, rows } = props;

  return (
    <div className="flex flex-col gap-4">
      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{title}</div>
        {sample && (
          <span className="rounded-xs bg-[var(--surface-3)] px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Sample
          </span>
        )}
        <div className="flex-1" />
        <div className="text-xs text-[var(--text-faint)]">{hint}</div>
      </div>
      <div className="shrink-0 overflow-hidden rounded-[var(--radius-l)] border border-border bg-card" style={{ opacity }}>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div
              className={`h-1.5 w-1.5 shrink-0 rounded-[2px] ${row.dot === "accent" ? "bg-accent-500" : "bg-[var(--text-faint)]"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{row.title}</div>
              <div className="mt-px text-xs text-muted-foreground">{row.hint}</div>
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.when}</div>
            {row.cta && (
              <button
                type="button"
                className="rounded-m border-[0.5px] border-[var(--line-strong)] bg-transparent px-[11px] py-[5px] text-xs font-medium text-foreground"
              >
                {row.cta}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
