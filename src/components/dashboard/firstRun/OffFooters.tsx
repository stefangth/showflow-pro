// src/components/dashboard/firstRun/OffFooters.tsx

/** The off-footer strip: one muted line per module that is off for the org
 *  ("Booking engine is not enabled for this org...", "Hire orders is off..."). Renders
 *  nothing when no module is off. Mirrors the offFooters block in
 *  docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html. */
export function OffFooters({ footers }: { footers: string[] }): JSX.Element | null {
  if (footers.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-[var(--radius-l)] border border-border bg-muted px-4 py-3.5">
      {footers.map((text, i) => (
        <div key={i} className="text-xs leading-[18px] text-muted-foreground">
          {text}
        </div>
      ))}
    </div>
  );
}
