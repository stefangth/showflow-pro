// src/components/dashboard/firstRun/DashboardWelcome.tsx
import type { DashboardWelcomeProps } from "@/lib/dashboard/types";

export function DashboardWelcome({ welcome, onPrimary, onSecondary }: DashboardWelcomeProps) {
  return (
    <div className="flex items-start justify-between gap-8 rounded-xl bg-accent-500 px-6 py-6 text-white">
      <div className="max-w-xl">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{welcome.eyebrow}</div>
        <h2 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight text-white text-pretty">{welcome.headline}</h2>
        <p className="mt-2 text-sm leading-[21px] text-white/80 text-pretty">{welcome.body}</p>
        <div className="mt-4 flex gap-2.5">
          <button onClick={onPrimary} className="rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-accent-700 hover:bg-white/90">{welcome.primaryLabel}</button>
          <button onClick={onSecondary} className="rounded-lg border-[0.5px] border-white/40 px-4 py-2 text-[13px] font-medium text-white hover:bg-white/10">{welcome.secondaryLabel}</button>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{welcome.progressLabel}</div>
        <div className="mt-2 flex justify-end gap-1">
          {Array.from({ length: welcome.progressTotal }).map((_, i) => (
            <div key={i} className={`h-[3px] w-[34px] rounded-full ${i < welcome.progressFilled ? "bg-white/90" : "bg-white/25"}`} />
          ))}
        </div>
        <div className="mt-2.5 text-xs text-white/60">{welcome.progressHint}</div>
      </div>
    </div>
  );
}
