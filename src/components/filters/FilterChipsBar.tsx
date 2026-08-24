import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IconTooltip } from '@/components/common/IconTooltip';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { CustomFieldFilter } from '@/components/filters/CustomFieldFilter';
import { emptyCustomFilter } from '@/components/filters/customFilterState';
import type { CustomFieldDefinition } from '@/data/customFields';
import type { CustomFilterState } from '@/lib/customFields';
import { formatDayMonthYear } from '@/lib/dates';
import { cn } from '@/lib/utils';

type StatusKind = 'status';
type ProgramKind = 'program';
type TimeframeKind = 'timeframe';
type CustomKind = `custom:${string}`;
type FilterKind = StatusKind | ProgramKind | TimeframeKind | CustomKind;

export interface StatusOption<TStatus extends string> {
  value: TStatus;
  label: string;
}

export interface FilterChipsBarProps<TStatus extends string> {
  /** Status filter — omit the whole affordance (menu entry + chip) when `showStatus` is false. */
  showStatus: boolean;
  statusValue: 'all' | TStatus;
  statusOptions: StatusOption<TStatus>[];
  onStatusChange: (v: 'all' | TStatus) => void;

  showProgram: boolean;
  programOptions: string[];
  programs: string[];
  onProgramsChange: (v: string[]) => void;

  showTimeframe: boolean;
  timeframe: TimeframeValue;
  onTimeframeChange: (v: TimeframeValue) => void;

  filterableDefs: CustomFieldDefinition[];
  customFilters: Record<string, CustomFilterState>;
  onCustomFilterChange: (def: CustomFieldDefinition, v: CustomFilterState) => void;
  onCustomFilterClear: (def: CustomFieldDefinition) => void;

  className?: string;
}

function isCustomFilterEmpty(filter: CustomFilterState): boolean {
  switch (filter.kind) {
    case 'text': return filter.q === '';
    case 'select': return filter.value === null;
    case 'number': return filter.min === null && filter.max === null;
    case 'date': return filter.from === null && filter.to === null;
    case 'boolean': return filter.value === null;
  }
}

/** Chip/back-header labels shown in the FilterChipsBar itself (bookings:filters.*). */
type FiltersT = (key: string, options?: Record<string, unknown>) => string;

function describeCustomFilter(filter: CustomFilterState, t: FiltersT): string {
  switch (filter.kind) {
    case 'text':
      return filter.q;
    case 'select':
      return filter.value ?? '';
    case 'boolean':
      return filter.value ? t('filters.yes') : t('filters.no');
    case 'number': {
      const { min, max } = filter;
      if (min !== null && max !== null) return t('filters.numberRange', { min, max });
      if (min !== null) return t('filters.numberMin', { min });
      return t('filters.numberMax', { max });
    }
    case 'date': {
      const from = filter.from ? formatDayMonthYear(filter.from) : null;
      const to = filter.to ? formatDayMonthYear(filter.to) : null;
      if (from && to) return t('filters.dateRangeValue', { from, to });
      if (from) return t('filters.dateFromValue', { from });
      return t('filters.dateToValue', { to });
    }
  }
}

function describeTimeframe(timeframe: TimeframeValue, t: FiltersT): string {
  const from = timeframe.from ? formatDayMonthYear(timeframe.from) : null;
  const to = timeframe.to ? formatDayMonthYear(timeframe.to) : null;
  if (from && to) return t('filters.dateRangeValue', { from, to });
  if (from) return t('filters.dateFromValue', { from });
  return t('filters.dateToValue', { to });
}

/**
 * Removable violet chips for the shows & bookings toolbar's active filters, plus a
 * dashed "Add filter" control that surfaces the right existing filter control
 * (status Select, `ProgramFilter`, `TimeframeFilter`, `CustomFieldFilter`) to set a
 * new one. Purely presentational over the caller's existing filter state — every
 * chip's remove action and every "Add filter" pick calls straight back into the
 * setters the page already had wired to `ShowsBookingsPage.tsx`'s filter predicate.
 *
 * Status and custom-field chips read "Label: value" (`filters.status`/`def.label`
 * prefix); program and timeframe chips show only the value itself, matching the
 * design mock (a program name or a date range reads fine unprefixed, a status enum
 * or a custom field's raw value does not).
 */
export function FilterChipsBar<TStatus extends string>({
  showStatus, statusValue, statusOptions, onStatusChange,
  showProgram, programOptions, programs, onProgramsChange,
  showTimeframe, timeframe, onTimeframeChange,
  filterableDefs, customFilters, onCustomFilterChange, onCustomFilterClear,
  className,
}: FilterChipsBarProps<TStatus>) {
  const { t } = useTranslation('bookings');
  const [open, setOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<FilterKind | null>(null);

  const closePicker = (o: boolean) => {
    setOpen(o);
    if (!o) setPickerKind(null);
  };

  const timeframeActive = !!(timeframe.from || timeframe.to);

  const activeCustomDefs = filterableDefs.filter((def) => {
    const f = customFilters[`custom.${def.key}`];
    return !!f && !isCustomFilterEmpty(f);
  });
  const inactiveCustomDefs = filterableDefs.filter((def) => {
    const f = customFilters[`custom.${def.key}`];
    return !f || isCustomFilterEmpty(f);
  });

  const addable: { kind: FilterKind; label: string }[] = [
    ...(showStatus && statusValue === 'all' ? [{ kind: 'status' as FilterKind, label: t('filters.status') }] : []),
    ...(showProgram ? [{ kind: 'program' as FilterKind, label: t('filters.program') }] : []),
    ...(showTimeframe && !timeframeActive ? [{ kind: 'timeframe' as FilterKind, label: t('filters.dateRange') }] : []),
    ...inactiveCustomDefs.map((def) => ({ kind: `custom:${def.key}` as FilterKind, label: def.label })),
  ];

  const pickerLabel = addable.find((a) => a.kind === pickerKind)?.label
    ?? (pickerKind === 'status' ? t('filters.status')
      : pickerKind === 'program' ? t('filters.program')
        : pickerKind === 'timeframe' ? t('filters.dateRange')
          : pickerKind ? (filterableDefs.find((d) => `custom:${d.key}` === pickerKind)?.label ?? '') : '');

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="filter-chips-bar">
      {showStatus && statusValue !== 'all' && (
        <Chip
          testId="filter-chip-status"
          label={`${t('filters.status')}: ${statusOptions.find((o) => o.value === statusValue)?.label ?? statusValue}`}
          onRemove={() => onStatusChange('all')}
          removeLabel={t('filters.removeAria', { label: t('filters.status') })}
        />
      )}
      {programs.map((program) => (
        <Chip
          key={program}
          testId={`filter-chip-program-${program}`}
          label={program}
          onRemove={() => onProgramsChange(programs.filter((p) => p !== program))}
          removeLabel={t('filters.removeAria', { label: program })}
        />
      ))}
      {showTimeframe && timeframeActive && (
        <Chip
          testId="filter-chip-timeframe"
          label={describeTimeframe(timeframe, t)}
          onRemove={() => onTimeframeChange({ from: null, to: null })}
          removeLabel={t('filters.removeAria', { label: t('filters.dateRange') })}
        />
      )}
      {activeCustomDefs.map((def) => {
        const filter = customFilters[`custom.${def.key}`] ?? emptyCustomFilter(def.type);
        return (
          <Chip
            key={def.id}
            testId={`filter-chip-custom-${def.key}`}
            label={`${def.label}: ${describeCustomFilter(filter, t)}`}
            onRemove={() => onCustomFilterClear(def)}
            removeLabel={t('filters.removeAria', { label: def.label })}
          />
        );
      })}

      <Popover open={open} onOpenChange={closePicker}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-1.5 border-dashed" data-testid="add-filter">
            <Plus className="h-3.5 w-3.5" />
            {t('filters.addFilter')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          {pickerKind === null ? (
            addable.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">{t('filters.allActive')}</p>
            ) : (
              <div className="flex flex-col">
                {addable.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    data-testid={`add-filter-option-${item.kind.replace(':', '-')}`}
                    onClick={() => setPickerKind(item.kind)}
                    className="flex items-center w-full gap-2 px-2 py-1.5 rounded-field text-sm hover:bg-accent text-left"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                data-testid="add-filter-back"
                aria-label={t('filters.backAria')}
                onClick={() => setPickerKind(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {pickerLabel}
              </button>
              {pickerKind === 'status' && (
                <div className="flex flex-col">
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`add-filter-status-${opt.value}`}
                      onClick={() => { onStatusChange(opt.value); closePicker(false); }}
                      className="flex items-center w-full gap-2 px-2 py-1.5 rounded-field text-sm hover:bg-accent text-left"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {pickerKind === 'program' && (
                <ProgramFilter options={programOptions} value={programs} onChange={onProgramsChange} className="w-full" />
              )}
              {pickerKind === 'timeframe' && (
                <TimeframeFilter value={timeframe} onChange={onTimeframeChange} className="w-full" />
              )}
              {pickerKind.startsWith('custom:') && (() => {
                const key = pickerKind.slice('custom:'.length);
                const def = filterableDefs.find((d) => d.key === key);
                if (!def) return null;
                return (
                  <CustomFieldFilter
                    def={def}
                    value={customFilters[`custom.${def.key}`] ?? emptyCustomFilter(def.type)}
                    onChange={(v) => onCustomFilterChange(def, v)}
                  />
                );
              })()}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Chip({ testId, label, onRemove, removeLabel }: { testId: string; label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <Badge variant="accent" className="gap-1 h-6 px-2" data-testid={testId}>
      <span className="truncate max-w-[220px]">{label}</span>
      <IconTooltip label={removeLabel}>
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="ml-0.5 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </IconTooltip>
    </Badge>
  );
}
