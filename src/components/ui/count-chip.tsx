import { cn } from '@/lib/utils';

/** The small tabular count beside a tab, nav row or filter. Active is the accent tint. */
export function CountChip({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-chip px-1 text-[10px] font-semibold tabular-nums',
        active ? 'bg-accent-50 text-accent-text' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
