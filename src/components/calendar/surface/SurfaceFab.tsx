import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SurfaceFabProps {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  className?: string;
}

/**
 * Fixed bottom-right extended FAB for mobile calendar surfaces (spec §5,
 * Phase 5 mobile). Presentational only — mounting it per role/breakpoint is
 * a caller concern (see Task 7).
 */
export function SurfaceFab({ label, onClick, icon, className }: SurfaceFabProps) {
  return (
    <button
      type="button"
      data-testid="surface-fab"
      onClick={onClick}
      className={cn(
        'fixed right-4 bottom-12 z-40 inline-flex h-[52px] items-center gap-2 rounded-control',
        'bg-primary px-5 text-body font-medium text-primary-foreground shadow-elev3',
        className,
      )}
    >
      {icon ?? <Plus className="h-[18px] w-[18px]" aria-hidden="true" />}
      {label}
    </button>
  );
}
