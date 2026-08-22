export function LatencyStat({ p95Ms }: { p95Ms: number | null }) {
  const text = p95Ms === null ? "—" : `p95 ${(p95Ms / 1000).toFixed(1)}s`;
  return <span className="tabular-nums text-muted-foreground">{text}</span>;
}
