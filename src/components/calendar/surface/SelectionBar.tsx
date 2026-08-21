import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SelectionBarAction {
  key: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SelectionBarProps {
  /** Selected date count (only counts keys that map to real dates). */
  count: number;
  actions: SelectionBarAction[];
  onAction: (key: string) => void;
  onClear: () => void;
  className?: string;
}

/**
 * Fixed-bottom bulk-action bar shown while the calendar surface has a range
 * selection. Left: the selected count and a control to clear it. Right: one
 * button per caller-supplied action, disabled/titled per its own gate.
 * Purely presentational: renders nothing when `count` is 0.
 */
export function SelectionBar({ count, actions, onAction, onClear, className }: SelectionBarProps) {
  const { t } = useTranslation('common');
  if (count === 0) return null;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label={t('calendar.selection.bulkActions')}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background px-4 py-3 shadow-elev3',
        className
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{t('calendar.selection.count', { count })}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="selection-bar-clear"
            onClick={onClear}
          >
            {t('calendar.selection.clear')}
          </Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant="outline"
              size="sm"
              disabled={action.disabled}
              title={action.title}
              data-testid={`selection-bar-action-${action.key}`}
              onClick={() => onAction(action.key)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
