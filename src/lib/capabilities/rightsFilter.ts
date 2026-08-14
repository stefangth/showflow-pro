export type RightsFilter = "All" | "Sensitive" | "Changed" | "Off";
interface Row { key: string; label: string; description: string; risk: "standard" | "sensitive"; effective: boolean; }
interface Ctx { query: string; filter: RightsFilter; changed: boolean; desired: boolean; }

export function matchesFilter(row: Row, ctx: Ctx): boolean {
  const q = ctx.query.trim().toLowerCase();
  if (q && !(`${row.label} ${row.description}`.toLowerCase().includes(q))) return false;
  if (ctx.filter === "Sensitive") return row.risk === "sensitive";
  if (ctx.filter === "Changed") return ctx.changed;
  if (ctx.filter === "Off") return !ctx.desired;
  return true;
}
export function filterCounts(
  rows: Array<Row & { changed: boolean; desired: boolean }>,
): Record<RightsFilter, number> {
  return {
    All: rows.length,
    Sensitive: rows.filter(r => r.risk === "sensitive").length,
    Changed: rows.filter(r => r.changed).length,
    Off: rows.filter(r => !r.desired).length,
  };
}
