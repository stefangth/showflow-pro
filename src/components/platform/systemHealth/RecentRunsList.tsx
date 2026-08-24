import { describeOutcomeParts, type EdgeFnOutcome } from "@/lib/systemHealth";
import { Token } from "@/components/ui/token";

/**
 * The last runs as text, newest first. This is the keyboard- and screen-reader-reachable
 * equivalent of the per-invocation detail the uptime bar cannot carry: the bar answers
 * "which day", this answers "which run, what code, how slow".
 */
export function RecentRunsList({ recent }: { recent: EdgeFnOutcome[] }) {
  if (recent.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        Recent runs ({recent.length})
      </summary>
      <div className="mt-2 space-y-1 rounded-control bg-well-tint p-2">
        {recent.map((o, i) => {
          const { status, rest } = describeOutcomeParts(o);
          return (
            <p
              key={i}
              data-testid="recent-run-row"
              // status <= 0 is "no HTTP response at all" — as much a fault as a 4xx or 5xx,
              // and it sorts below 400, so it needs its own check.
              className={o.status <= 0 || o.status >= 400 ? "text-destructive" : undefined}
            >
              <Token>{status}</Token> · {rest}
            </p>
          );
        })}
      </div>
    </details>
  );
}
