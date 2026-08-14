import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SyncLogSummary } from "@/data/airtableSync";

import { statusBadge, type StatusTone } from "./console";

interface ActivityTabProps {
  runs: SyncLogSummary[];
  loading?: boolean;
}

const GRID = "grid grid-cols-[minmax(150px,1.6fr)_repeat(5,minmax(56px,1fr))] gap-3";
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";

/** Status-badge colour by tone. Red uses the semantic destructive utilities;
 *  green/amber come from the DS CSS vars (not wired as Tailwind utilities). */
function badgeClass(tone: StatusTone): string {
  return tone === "red" ? "bg-destructive/10 text-destructive" : "";
}

function badgeStyle(tone: StatusTone): CSSProperties | undefined {
  if (tone === "green") return { background: "var(--green-100)", color: "var(--green-600)" };
  if (tone === "amber") return { background: "var(--amber-100)", color: "var(--amber-600)" };
  return undefined;
}

/** The Activity tab: the full run-history table, newest first. */
export function ActivityTab({ runs, loading }: ActivityTabProps) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4">
        <h3 className="text-[17px] font-semibold tracking-tight">Run history</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Every poll for this org, newest first.
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className={cn(GRID, "border-b border-border bg-muted px-4 py-2.5", EYEBROW)}>
            <span>Started</span>
            <span>Status</span>
            <span>Read</span>
            <span>New</span>
            <span>Updated</span>
            <span>Held</span>
          </div>

          {loading ? (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className={cn(GRID, "items-center border-b border-border px-4 py-2.5")}>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </>
          ) : runs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            runs.map((run) => {
              const badge = statusBadge(run.status);
              const held = run.held_count ?? 0;
              return (
                <div
                  key={run.id}
                  className={cn(
                    GRID,
                    "items-center border-b border-border px-4 py-2.5 font-mono text-xs tabular-nums",
                  )}
                >
                  <span className="text-muted-foreground">
                    {new Date(run.synced_at).toLocaleString()}
                  </span>
                  <span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-[4px] px-1.5 py-0.5 font-sans text-[11px] font-medium",
                        badgeClass(badge.tone),
                      )}
                      style={badgeStyle(badge.tone)}
                    >
                      {badge.label}
                    </span>
                  </span>
                  <span>{run.records_processed ?? 0}</span>
                  <span>{run.new_count ?? 0}</span>
                  <span>{run.updated_count ?? 0}</span>
                  <span style={held > 0 ? { color: "var(--amber-600)" } : undefined}>{held}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
