import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PeriodNavigatorProps {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  className?: string;
}

/** Prev / label / next + a "Today" jump control, for the calendar toolbar. */
export function PeriodNavigator({ label, onPrev, onNext, onToday, className }: PeriodNavigatorProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="period-navigator-prev"
        aria-label="Previous period"
        onClick={onPrev}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[9rem] text-center font-display text-sm font-semibold">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="period-navigator-next"
        aria-label="Next period"
        onClick={onNext}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="period-navigator-today"
        onClick={onToday}
        className="ml-1"
      >
        Today
      </Button>
    </div>
  );
}
