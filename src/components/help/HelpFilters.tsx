import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HelpFilter } from '@/lib/help/filter';
import { cn } from '@/lib/utils';

const FILTERS: { key: HelpFilter; labelKey: 'filter.all' | 'filter.new' }[] = [
  { key: 'all', labelKey: 'filter.all' },
  { key: 'new', labelKey: 'filter.new' },
];

export function HelpFilters({
  filter,
  onFilter,
  query,
  onQuery,
  countLabel,
}: {
  filter: HelpFilter;
  onFilter: (f: HelpFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  countLabel: string;
}) {
  const { t } = useTranslation('help');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] max-w-[380px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground/60" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-9 w-full rounded-lg border-[0.5px] border-border bg-card pl-8 pr-3 text-sm text-foreground shadow-sm outline-none focus:border-accent-400"
        />
      </div>
      <div className="flex gap-1.5">
        {FILTERS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => onFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              'rounded px-2.5 py-1.5 text-xs transition-colors',
              filter === key
                ? 'bg-accent-100 font-semibold text-accent-700'
                : 'border-[0.5px] border-border font-medium text-muted-foreground hover:bg-muted/50',
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{countLabel}</span>
    </div>
  );
}
