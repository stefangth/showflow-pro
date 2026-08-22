import { Check } from "lucide-react";

/** The collapsed/resume bar a page mini shows once the viewer has hidden it: a one-row
 *  strip with the mini's eyebrow, a hint, and a resume button. Relocated here (from the
 *  retired dashboard first-run surface) since `PageMini` is now its only consumer. */
export interface PageMiniCollapsedProps {
  label: string;
  hint: string;
  ctaLabel: string;
  onOpen: () => void;
}

export function PageMiniCollapsed({ label, hint, ctaLabel, onOpen }: PageMiniCollapsedProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-l border-[0.5px] border-border bg-card px-3.5 py-2.5">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent-tint">
        <Check className="h-3 w-3 text-accent-text" strokeWidth={3} />
      </span>
      <span className="text-control font-medium text-foreground">{label}</span>
      <span className="text-control text-muted-foreground/70">{hint}</span>
      <span className="flex-1" />
      <button onClick={onOpen} className="rounded-l border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-hover-tint">{ctaLabel}</button>
    </div>
  );
}
