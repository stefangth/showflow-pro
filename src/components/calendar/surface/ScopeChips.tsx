import { useTranslation } from 'react-i18next';
import { DISPLAY_ORDER, type NeedsYouQueue, type NeedsYouScopeKey } from '@/lib/calendar/needsYou';
import { cn } from '@/lib/utils';

interface ScopeChipsProps {
  /** Unfiltered queue — counts always reflect the full breakdown, even while
   *  `active` narrows what `CalendarSurface` renders below. */
  queue: NeedsYouQueue;
  active: NeedsYouScopeKey;
  onChange: (scope: NeedsYouScopeKey) => void;
  className?: string;
}

interface ScopeChipProps {
  scopeKey: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function ScopeChip({ scopeKey, label, count, active, onClick }: ScopeChipProps) {
  return (
    <button
      type="button"
      data-testid={`scope-chip-${scopeKey}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border-[0.5px] px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted'
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] px-1 font-mono text-[10px] font-semibold tabular-nums',
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-foreground/[.06] text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Needs-you scope-chip row (design gap-analysis §1, mock lines 137-143): one
 * pill per non-empty queue group plus an "All" pill, each with a live count
 * — filters the queue body down to a single category. Derived entirely from
 * the already-built `queue` (`countByGroup`/`totalItems`), no data fetch of
 * its own. `CalendarSurface` renders this only while the active lens is
 * Needs-you and owns the selected `active` scope as state, applying it via
 * `filterNeedsYouQueueByScope` before handing the queue to `NeedsYouLens`.
 */
export function ScopeChips({ queue, active, onChange, className }: ScopeChipsProps) {
  const { t } = useTranslation('bookings');
  const presentGroupKeys = DISPLAY_ORDER.filter((key) => queue.countByGroup[key] > 0);

  return (
    <div data-testid="scope-chip-row" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <ScopeChip
        scopeKey="all"
        label={t('calendar.needsYou.scopeChips.all')}
        count={queue.totalItems}
        active={active === 'all'}
        onClick={() => onChange('all')}
      />
      {presentGroupKeys.map((key) => (
        <ScopeChip
          key={key}
          scopeKey={key}
          label={t(`calendar.needsYou.scopeChips.${key}`)}
          count={queue.countByGroup[key]}
          active={active === key}
          onClick={() => onChange(key)}
        />
      ))}
    </div>
  );
}
