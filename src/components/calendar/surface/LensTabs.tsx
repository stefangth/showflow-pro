import { cn } from '@/lib/utils';

export interface LensTabDef {
  key: string;
  label: string;
  count?: number;
}

interface LensTabsProps {
  lenses: LensTabDef[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  /**
   * Renders the tab row as a single non-wrapping, horizontally-scrolling
   * strip with snap points — the mobile lens switcher. Default (false)
   * keeps the desktop inline-flex segmented-control layout unchanged.
   */
  scrollable?: boolean;
}

/**
 * Segmented lens switcher for the calendar surface header (Needs you / Month
 * / Week / …). A neutral, recessed segmented control — not a brand-color
 * fill — mirroring the app's own `TabsTrigger`/`SegmentedControl` active
 * convention (`bg-card text-foreground shadow-elev1`).
 */
export function LensTabs({ lenses, active, onChange, className, scrollable = false }: LensTabsProps) {
  return (
    <div
      className={cn(
        'items-center rounded-m border border-[var(--line-strong)] bg-[var(--surface-3)] p-0.5',
        scrollable ? 'flex gap-2 overflow-x-auto snap-x' : 'inline-flex gap-0.5',
        className
      )}
      role="tablist"
    >
      {lenses.map(lens => {
        const isActive = lens.key === active;
        return (
          <button
            key={lens.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`lens-tab-${lens.key}`}
            data-active={isActive}
            onClick={() => onChange(lens.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-s px-3 py-1.5 text-control font-medium transition-colors',
              scrollable && 'shrink-0 snap-start',
              isActive ? 'bg-card text-foreground shadow-elev1' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {typeof lens.count === 'number' && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1 font-mono text-eyebrow font-semibold tabular-nums',
                  isActive ? 'bg-accent-50 text-accent-text' : 'bg-foreground/5 text-muted-foreground'
                )}
              >
                {lens.count}
              </span>
            )}
            <span>{lens.label}</span>
          </button>
        );
      })}
    </div>
  );
}
