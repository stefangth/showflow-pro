import { cn } from "@/lib/utils";
import { APP_META, CHANGELOG_URL } from "@/config/app.config";
import { Token } from "@/components/ui/token";

/**
 * Two-tone ShowFlow wordmark + version pill. Shared by the desktop sidebar and the
 * mobile topbar so the brand styling can't drift between them. Pass `className` to
 * control the wrapper — e.g. `flex-1` in the sidebar so the pill right-aligns to the
 * rail edge. The two-tone split is intentional product branding.
 *
 * The pill links to the public changelog. `title` rather than a shadcn `Tooltip`: this
 * also renders in the mobile topbar, and shouldn't require a `TooltipProvider` above it.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-baseline gap-1.5 min-w-0", className)}>
      <span className="font-display text-body font-semibold tracking-[-0.02em] truncate">
        <span className="text-foreground">Show</span>
        {/* text-accent-text (not text-primary): the DS accent-text role lifts to
            #C9BCFF on the dark ground so "Flow" clears AA contrast in dark mode,
            where raw text-primary (#6E5CF6) only hit 3.38:1. See docs/ui-conventions.md §4. */}
        <span className="text-accent-text">Flow</span>
      </span>
      <a
        href={CHANGELOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="What's new in ShowFlow"
        aria-label={`View changelog (version ${APP_META.VERSION})`}
        className="ml-auto shrink-0 rounded border border-border px-1 py-px text-eyebrow font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Token>v{APP_META.VERSION}</Token>
      </a>
    </div>
  );
}
