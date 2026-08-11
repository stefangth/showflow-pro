// src/components/dashboard/firstRun/StageCard.tsx
//
// Faithful reproduction of stageCard(s) / stepRow(st, hot) / stepsBlock(...)
// from docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html,
// translated to the project's Tailwind house idiom. The color-mix(...) values used for
// muted-on-violet text/borders on the hot card have no Tailwind utility equivalent and
// stay inline styles, exactly as the reproduction keeps them inline.
import type { DockedStep, Stage, StageAction } from "@/lib/dashboard/stageChain.types";

// HOT_* — color-mix constants ported verbatim from the reproduction's <script>.
const HOT_MUTE = "color-mix(in srgb, var(--surface) 74%, var(--accent-700))";
const HOT_SOFT = "color-mix(in srgb, var(--surface) 85%, var(--accent-700))";
const HOT_LINE = "color-mix(in srgb, var(--surface) 22%, var(--accent-700))";
const HOT_DOT = "color-mix(in srgb, var(--surface) 55%, var(--accent-700))";
const HOT_CHIPBG = "color-mix(in srgb, var(--surface) 20%, var(--accent-700))";
const HOT_CHIPBG2 = "color-mix(in srgb, var(--surface) 14%, var(--accent-700))";

/** stepRow(st, hot) */
function StepRow({ step, hot }: { step: DockedStep; hot: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {step.done ? (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mt-1 shrink-0 ${hot ? "text-primary-foreground" : "text-accent-500"}`}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <div
          className={`mt-1 h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] ${hot ? "" : "border-[var(--line-strong)]"}`}
          style={hot ? { borderColor: HOT_DOT } : undefined}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className={[
              "text-xs",
              step.done ? "font-normal" : "font-medium",
              step.done ? (hot ? "" : "text-[var(--text-faint)]") : hot ? "text-primary-foreground" : "text-foreground",
            ].join(" ")}
            style={step.done && hot ? { color: HOT_MUTE } : undefined}
          >
            {step.label}
          </div>
          {step.hard && (
            <span
              className={[
                "rounded-xs px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.4px]",
                hot ? "text-primary-foreground" : "bg-[var(--amber-100)] text-[var(--amber-600)]",
              ].join(" ")}
              style={hot ? { background: HOT_CHIPBG } : undefined}
            >
              {step.hardLabel}
            </span>
          )}
          {step.soft && (
            <span
              className={[
                "rounded-xs px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.4px]",
                hot ? "" : "bg-[var(--surface-3)] text-[var(--text-faint)]",
              ].join(" ")}
              style={hot ? { background: HOT_CHIPBG2, color: HOT_SOFT } : undefined}
            >
              Slows filling
            </span>
          )}
          {step.admin && (
            <span
              className={[
                "rounded-xs px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.4px]",
                hot ? "" : "bg-[var(--surface-3)] text-[var(--text-faint)]",
              ].join(" ")}
              style={hot ? { background: HOT_CHIPBG2, color: HOT_SOFT } : undefined}
            >
              Admin
            </span>
          )}
        </div>
        {step.hint && (
          <div
            className={`mt-px text-[11px] leading-4 text-pretty ${hot ? "" : "text-[var(--text-faint)]"}`}
            style={hot ? { color: HOT_SOFT } : undefined}
          >
            {step.hint}
          </div>
        )}
      </div>
    </div>
  );
}

/** stepsBlock(steps, hot, lineColor) */
function StepsBlock({ steps, hot }: { steps: DockedStep[]; hot: boolean }) {
  if (!steps.length) return null;
  return (
    <div
      className={`mt-3 flex flex-col gap-[7px] border-t-[0.5px] pt-2.5 ${hot ? "" : "border-border"}`}
      style={hot ? { borderColor: HOT_LINE } : undefined}
    >
      {steps.map((step) => (
        <StepRow key={step.key} step={step} hot={hot} />
      ))}
    </div>
  );
}

/** stageCard(s) — arrow (per DashboardChain's "before every stage where stage.n !== '01'"
 *  rule) is drawn by the same component so the arrow and card stay one flex-row unit,
 *  matching the reproduction's `return arrow + card`. */
export function StageCard({ stage, onAction }: { stage: Stage; onAction: (action: StageAction) => void }) {
  const hot = stage.variant === "hot";
  const plain = stage.variant === "plain";
  const dim = stage.variant === "dim";

  const handleClick = () => {
    if (stage.action) onAction(stage.action);
  };

  return (
    <>
      {stage.n !== "01" && (
        <div className="flex w-[26px] shrink-0 items-center justify-center text-[var(--text-faint)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h13" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </div>
      )}
      <div
        className={[
          "flex min-w-0 flex-1 flex-col rounded-[var(--radius-l)] p-4",
          hot && "bg-accent-700 border-[0.5px] border-accent-700 shadow-elev2",
          plain && "bg-card border-[0.5px] border-border",
          dim && "bg-transparent border-[0.5px] border-dashed border-[var(--line-strong)]",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="flex items-center gap-1.5">
          <div className={`font-mono text-[11px] ${hot ? "" : "text-[var(--text-faint)]"}`} style={hot ? { color: HOT_MUTE } : undefined}>
            {stage.n}
          </div>
          <div className="flex-1" />
          {hot && (
            <span className="rounded-xs bg-card px-1.5 py-0.5 text-[11px] font-semibold text-accent-700">Start here</span>
          )}
          {plain && stage.running && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Running
            </span>
          )}
          {dim && stage.badge && (
            <span className="rounded-xs bg-[var(--surface-3)] px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {stage.badge}
            </span>
          )}
        </div>

        <div
          className={[
            "mt-2 text-base font-semibold tracking-[-0.1px]",
            hot ? "text-primary-foreground" : dim ? "text-muted-foreground" : "text-foreground",
          ].join(" ")}
        >
          {stage.name}
        </div>
        <div className={`mt-[3px] text-[11px] font-medium ${hot ? "" : "text-[var(--text-faint)]"}`} style={hot ? { color: HOT_MUTE } : undefined}>
          {stage.tag}
        </div>
        <div
          className={`mt-2 text-xs leading-[18px] text-pretty ${hot ? "" : "text-muted-foreground"}`}
          style={hot ? { color: HOT_SOFT } : undefined}
        >
          {stage.line}
        </div>

        {(hot || plain) && stage.metric !== null && (
          <div className="mt-2.5 flex items-baseline gap-[5px]">
            <div className={`font-mono text-[22px] font-semibold tracking-[-0.4px] ${hot ? "text-primary-foreground" : "text-foreground"}`}>
              {stage.metric}
            </div>
            <div className={`text-xs ${hot ? "" : "text-[var(--text-faint)]"}`} style={hot ? { color: HOT_MUTE } : undefined}>
              {stage.metricLabel}
            </div>
          </div>
        )}

        {dim && stage.needs && (
          <div className="mt-2 font-mono text-xs leading-[18px] text-[var(--text-faint)] text-pretty">{stage.needs}</div>
        )}

        <StepsBlock steps={stage.steps} hot={hot} />

        <div className="min-h-[12px] flex-1" />

        {stage.ctaLabel &&
          (stage.ctaIsPrimary ? (
            <button
              type="button"
              onClick={handleClick}
              className="mt-3 self-start rounded-m border-0 bg-card px-3.5 py-2 text-[13px] font-semibold text-accent-700 hover:bg-muted"
            >
              {stage.ctaLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              className="mt-3 self-start rounded-m border-[0.5px] border-[var(--line-strong)] bg-transparent px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              {stage.ctaLabel}
            </button>
          ))}
      </div>
    </>
  );
}
