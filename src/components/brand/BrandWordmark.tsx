import { cn } from "@/lib/utils";
import { APP_META } from "@/config/app.config";

/**
 * Two-tone ShowFlow wordmark + version pill. Shared by the desktop sidebar and the
 * mobile topbar so the brand styling can't drift between them. Pass `className` to
 * control the wrapper — e.g. `flex-1` in the sidebar so the pill right-aligns to the
 * rail edge. The two-tone split is intentional product branding.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-baseline gap-1.5 min-w-0", className)}>
      <span className="font-display text-[15px] font-semibold tracking-[-0.02em] truncate">
        <span className="text-foreground">Show</span>
        <span className="text-primary">Flow</span>
      </span>
      <span className="ml-auto shrink-0 rounded border border-border px-1 py-px font-mono text-[9px] font-medium tabular-nums text-muted-foreground">
        v{APP_META.VERSION}
      </span>
    </div>
  );
}
