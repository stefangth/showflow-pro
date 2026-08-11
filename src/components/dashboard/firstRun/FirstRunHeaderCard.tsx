// src/components/dashboard/firstRun/FirstRunHeaderCard.tsx

/** The dashboard first-run header card: a headline + ghost CTA on the left,
 *  a 264px progress card (ticks + module on/off list) on the right. Pure
 *  presentational leaf — see docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html
 *  (the header-card block in render()) for the source markup this mirrors. */
export function FirstRunHeaderCard(props: {
  eyebrow: string;
  headline: string;
  body: string;
  ghost: string;
  hint: string;
  progressLabel: string;
  progressHint: string;
  hasSteps: boolean;
  ticks: boolean[];
  modules: { label: string; on: boolean }[];
  onGhost?: () => void;
}): JSX.Element {
  const { eyebrow, headline, body, ghost, hint, progressLabel, progressHint, hasSteps, ticks, modules, onGhost } = props;

  return (
    <div className="flex shrink-0 items-start gap-8 rounded-[var(--radius-xl)] border border-border bg-card px-6 py-[22px]">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-600">{eyebrow}</div>
        <div className="mt-2 max-w-[600px] text-[32px] font-semibold leading-[38px] tracking-[-0.6px] text-foreground text-pretty">
          {headline}
        </div>
        <div className="mt-2 max-w-[520px] text-sm leading-[21px] text-muted-foreground text-pretty">{body}</div>
        <div className="mt-4 flex items-center gap-2.5">
          {onGhost && (
            <button
              type="button"
              onClick={onGhost}
              className="rounded-m border-[0.5px] border-[var(--line-strong)] bg-transparent px-4 py-[9px] text-[13px] font-medium text-foreground hover:bg-muted"
            >
              {ghost}
            </button>
          )}
          <span className="text-xs text-[var(--text-faint)]">{hint}</span>
        </div>
      </div>

      <div className="w-[264px] shrink-0 rounded-[var(--radius-l)] border border-border bg-muted p-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{progressLabel}</div>
        {hasSteps && (
          <div className="mt-2.5 flex gap-[3px]">
            {ticks.map((filled, i) => (
              <div
                key={i}
                data-testid="first-run-tick"
                data-filled={filled ? "true" : "false"}
                className={`h-[3px] flex-1 rounded-full ${filled ? "bg-accent-500" : "bg-[var(--surface-3)]"}`}
              />
            ))}
          </div>
        )}
        <div className="mt-2.5 text-xs leading-[18px] text-muted-foreground text-pretty">{progressHint}</div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-2.5">
          {modules.map((m) => (
            <div key={m.label} data-testid={`first-run-module-${m.label}`} className="flex items-baseline gap-[7px]">
              <div className={`h-1.5 w-1.5 shrink-0 rounded-[2px] ${m.on ? "bg-accent-500" : "bg-[var(--text-faint)]"}`} />
              <div className="text-xs font-medium text-foreground">{m.label}</div>
              <div className="flex-1" />
              <div className={`text-[11px] font-semibold ${m.on ? "text-accent-600" : "text-[var(--text-faint)]"}`}>
                {m.on ? "On" : "Off"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
