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

/** Prev / label / next (in a bordered pill) + a separate "Today" jump control,
 *  for the calendar toolbar. */
export function PeriodNavigator({ label, onPrev, onNext, onToday, className }: PeriodNavigatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        data-testid="period-navigator-pill"
        className="inline-flex h-8 items-center gap-0.5 rounded-m border border-[var(--line-strong)] bg-card px-0.5"
      >
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
        <span className="min-w-[8rem] text-center text-[13px] font-medium">{label}</span>
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
      </div>
      <Button type="button" variant="outline" size="sm" data-testid="period-navigator-today" onClick={onToday}>
        Today
      </Button>
    </div>
  );
}
