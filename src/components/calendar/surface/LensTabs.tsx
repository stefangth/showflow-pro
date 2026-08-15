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
}

/** Segmented lens switcher for the calendar surface header (Needs you / Month / Week / …). */
export function LensTabs({ lenses, active, onChange, className }: LensTabsProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5', className)}
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
              'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground shadow-elev1'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{lens.label}</span>
            {typeof lens.count === 'number' && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {lens.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
