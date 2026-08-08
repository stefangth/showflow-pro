// src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx
import { Check } from "lucide-react";
import type { DashboardWelcomeCollapsedProps } from "@/lib/dashboard/types";

export function DashboardWelcomeCollapsed({ label, hint, ctaLabel, onOpen }: DashboardWelcomeCollapsedProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border-[0.5px] border-border bg-card px-3.5 py-2.5">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent-100">
        <Check className="h-3 w-3 text-accent-700" strokeWidth={3} />
      </span>
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      <span className="text-[13px] text-muted-foreground/70">{hint}</span>
      <span className="flex-1" />
      <button onClick={onOpen} className="rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">{ctaLabel}</button>
    </div>
  );
}
