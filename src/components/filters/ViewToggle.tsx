import { LayoutList, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'calendar';

interface Props {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-control border border-input bg-background p-0.5">
      {(['list', 'calendar'] as const).map(mode => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-field transition-colors',
            value === mode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {mode === 'list' ? <LayoutList className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
          <span className="capitalize">{mode}</span>
        </button>
      ))}
    </div>
  );
}
