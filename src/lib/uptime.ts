import { SYSTEM_HEALTH } from "@/config/app.config";

/** One health_daily row as returned by get_health_daily. Mirrors the table's columns. */
export interface HealthDay {
  day: string;              // 'YYYY-MM-DD' (UTC calendar day, as written by health-rollup)
  fn: string;
  runs: number;
  failures: number;         // 5xx plus "no response at all"
  rejected: number;         // 4xx
  worst_status: number | null;
  p95_ms: number | null;
}

export type DayState = "operational" | "degraded" | "down" | "nodata";

export interface UptimeCell {
  day: string;
  state: DayState;
  runs: number;
  failures: number;
  rejected: number;
  worstStatus: number | null;
}

/** 4xx fraction above which a day reads degraded. Imported rather than redeclared: a local
 *  copy would drift from the live-status thresholds silently, and the bar and the pill would
 *  then disagree about the same function. An occasional validation 400 is normal traffic; a
 *  sustained rejection rate is a broken caller. */
const REJECT_RATE_BUDGET = SYSTEM_HEALTH.rejectRateBudget;

const EMPTY = (day: string): UptimeCell =>
  ({ day, state: "nodata", runs: 0, failures: 0, rejected: 0, worstStatus: null });

/** UTC day key. health-rollup writes UTC days (it runs on a server with no user timezone),
 *  so the bar must bucket in UTC too or the lookup silently misses near midnight. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function classify(row: HealthDay): DayState {
  // Zero runs is idle, not broken. Most on-demand functions go days without a call, and painting
  // those red would make the bar useless.
  if (row.runs === 0) return "nodata";
  if (row.failures >= row.runs) return "down";
  if (row.failures > 0) return "degraded";
  if (row.rejected / row.runs > REJECT_RATE_BUDGET) return "degraded";
  return "operational";
}

/**
 * Build the fixed-width cell series for one function, oldest first, ending on `now`'s day.
 * Days with no rollup row come back as "nodata" — the bar ships before any history exists,
 * and an unrecorded day must never render as a green claim about uptime.
 */
export function buildUptimeCells(rows: HealthDay[], days: number, now: Date): UptimeCell[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: UptimeCell[] = [];
  for (let back = days - 1; back >= 0; back--) {
    // Date.UTC day overflow: correct across month boundaries, and immune to DST because
    // UTC has none — which is the other reason the keys are UTC rather than local.
    const key = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)));
    const row = byDay.get(key);
    out.push(row
      ? {
        day: key,
        state: classify(row),
        runs: row.runs,
        failures: row.failures,
        rejected: row.rejected,
        worstStatus: row.worst_status,
      }
      : EMPTY(key));
  }
  return out;
}

/**
 * Successful-run percentage across the days that have data. Days with no rollup are excluded
 * rather than counted as 0% or 100%: on a fresh install almost every day is blank, and either
 * choice would print a confident number about a period nothing was recorded for.
 * Returns null when no day has a single run.
 */
export function uptimePercent(cells: UptimeCell[]): number | null {
  let runs = 0;
  let failures = 0;
  for (const c of cells) { runs += c.runs; failures += c.failures; }
  if (runs === 0) return null;
  return ((runs - failures) / runs) * 100;
}

/** Tooltip line for one day cell. */
export function describeUptimeDay(cell: UptimeCell): string {
  // Parsed as local midnight, not `new Date('YYYY-MM-DD')` (which parses as UTC and can render
  // the previous day for viewers west of Greenwich).
  const [y, m, d] = cell.day.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });
  if (cell.state === "nodata" && cell.runs === 0) return `${label} · no data recorded`;

  const parts = [label, `${cell.runs} runs`];
  parts.push(cell.failures === 0
    ? "no failures"
    : `${cell.failures} ${cell.failures === 1 ? "failure" : "failures"}`);
  if (cell.rejected > 0) parts.push(`${cell.rejected} rejected`);
  // Only when something actually went wrong — on a clean day the worst status is 200, which
  // adds nothing next to "no failures".
  if (cell.worstStatus !== null && cell.failures + cell.rejected > 0) parts.push(`HTTP ${cell.worstStatus}`);
  return parts.join(" · ");
}
