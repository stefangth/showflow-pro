import type { MouseEvent } from 'react';
import { useState } from 'react';
import { format, startOfWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import type { ActionGates, ProducerActionKey, ProducerDateEntry, ProducerStatus } from '@/lib/calendar/types';
import { PRODUCER_TONES, TONE_TEXT } from '@/lib/calendar/tone';
import { dfLocale, toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { buildAgendaRows, type AgendaGrouping } from '@/lib/calendar/agendaRows';
import { FillMeter } from './FillMeter';

const AGENDA_GROUPING_STORAGE_KEY = 'showflow.calendar.agendaGrouping';

function readStoredGrouping(): AgendaGrouping {
  try {
    const stored = localStorage.getItem(AGENDA_GROUPING_STORAGE_KEY);
    return stored === 'per-date' || stored === 'per-show' ? stored : 'per-date';
  } catch {
    return 'per-date';
  }
}

export type AgendaAction = 'generate' | 'confirm' | 'open';

/** Contextual action per date status (task 12 brief): only these three
 *  statuses carry a row action — cancelled/unconfigured dates get none. A
 *  `fully_filled` date only offers Generate when it has no active order yet
 *  (`hireOrderId == null`); an already-ordered date gets no action here — the
 *  row instead renders its order status badge in the action column. */
const ACTION_BY_STATUS_KEY: Partial<Record<ProducerStatus, { i18nKey: ParseKeys<'bookings'>; action: AgendaAction }>> = {
  fully_filled: { i18nKey: 'calendar.agenda.generateHireOrder', action: 'generate' },
  partially_filled: { i18nKey: 'calendar.agenda.confirmHolds', action: 'confirm' },
  open: { i18nKey: 'calendar.agenda.openCasting', action: 'open' },
};

function actionForEntry(entry: ProducerDateEntry): { i18nKey: ParseKeys<'bookings'>; action: AgendaAction } | undefined {
  if (entry.status === 'fully_filled' && entry.hireOrderId != null) return undefined;
  return ACTION_BY_STATUS_KEY[entry.status];
}

/** Maps a row's resolved `AgendaAction` to the `ActionGates` key that gates
 *  it, so the row's action button can look up the caller's capability gate. */
const GATE_KEY_BY_ACTION: Record<AgendaAction, ProducerActionKey> = {
  confirm: 'confirmHolds',
  generate: 'generateHireOrder',
  open: 'openCasting',
};

const WEEK_OPTS = { weekStartsOn: 1 as const };

interface WeekGroup {
  key: string;
  weekStart: Date;
  entries: ProducerDateEntry[];
}

function groupByWeek(entries: ProducerDateEntry[]): WeekGroup[] {
  const byWeek = new Map<string, WeekGroup>();
  for (const entry of entries) {
    const weekStart = startOfWeek(entry.date, WEEK_OPTS);
    const key = toDateKey(weekStart);
    const group = byWeek.get(key) ?? { key, weekStart, entries: [] };
    group.entries.push(entry);
    byWeek.set(key, group);
  }
  return Array.from(byWeek.values())
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map(group => ({
      ...group,
      entries: [...group.entries].sort((a, b) => a.date.getTime() - b.date.getTime()),
    }));
}

interface AgendaLensProps {
  entries: ProducerDateEntry[];
  /** Open THIS row's date. Each row is one entry, so we pass the entry (not
   *  just its calendar day) — a day can carry several dates, and opening "the
   *  first entry on that day" would open the wrong one. */
  onOpenEntry: (entry: ProducerDateEntry) => void;
  onAction: (entry: ProducerDateEntry, action: AgendaAction) => void;
  /** Capability gates for the row action buttons (Confirm holds / Generate
   *  hire order / Open casting). When a row's resolved action is gated
   *  `disabled`, its button renders `disabled` with `title` as its tooltip
   *  instead of firing `onAction`. */
  actionGates?: ActionGates;
  className?: string;
}

/**
 * Producer Agenda lens: `entries` grouped into ISO (Monday-first) weeks, each
 * an uppercase week label + a card of rows (design lines 423-464). Each row
 * shows the dow/date, session time, program/venue, a fill meter +
 * `confirmedMain/mainSlots main`, a status badge, and — for
 * fully_filled/partially_filled/open dates only — a single contextual
 * action button (`ACTION_BY_STATUS`). Clicking the row opens that row's date;
 * clicking the action button fires `onAction` instead (its click does not
 * bubble into the row's `onOpenEntry`). Rows reflow to a single-column stack
 * below the `md:` breakpoint (768px, matching `useIsMobile`) via responsive
 * classes — the caller decides what a row tap means (mobile routes it
 * through the day sheet instead of navigating straight to the date; see
 * `CalendarSurface`'s mobile branch), this component just renders.
 */
export function AgendaLens({ entries, onOpenEntry, onAction, actionGates, className }: AgendaLensProps) {
  const { t } = useTranslation('bookings');
  const weeks = groupByWeek(entries);
  const [grouping, setGrouping] = useState<AgendaGrouping>(readStoredGrouping);

  const setGroupingPersisted = (next: AgendaGrouping) => {
    setGrouping(next);
    try {
      localStorage.setItem(AGENDA_GROUPING_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (e.g. private browsing) — grouping just
      // won't persist across reloads, which is a harmless degradation.
    }
  };

  return (
    <div data-testid="agenda-lens" className={cn('flex flex-col gap-5', className)}>
      <div
        role="group"
        aria-label={t('calendar.agenda.groupingLabel')}
        className="flex items-center justify-end gap-0.5 self-end rounded-m border border-border p-0.5"
      >
        <button
          type="button"
          data-testid="agenda-grouping-per-date"
          aria-pressed={grouping === 'per-date'}
          onClick={() => setGroupingPersisted('per-date')}
          className={cn(
            'rounded-s px-2 py-1 text-xs transition-colors',
            grouping === 'per-date'
              ? 'bg-accent-50 font-medium text-accent-text'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('calendar.agenda.groupingPerDate')}
        </button>
        <button
          type="button"
          data-testid="agenda-grouping-per-show"
          aria-pressed={grouping === 'per-show'}
          onClick={() => setGroupingPersisted('per-show')}
          className={cn(
            'rounded-s px-2 py-1 text-xs transition-colors',
            grouping === 'per-show'
              ? 'bg-accent-50 font-medium text-accent-text'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('calendar.agenda.groupingPerShow')}
        </button>
      </div>
      {weeks.map(week => (
        <div key={week.key} data-testid={`agenda-week-${week.key}`}>
          <div className="flex items-baseline gap-2.5 pb-2">
            <Eyebrow className="text-primary">
              {t('calendar.agenda.weekOfHeading', { weekStart: format(week.weekStart, 'd MMM', { locale: dfLocale() }) })}
            </Eyebrow>
            <span className="font-mono text-eyebrow text-muted-foreground">
              {t('calendar.agenda.dateCount', { count: week.entries.length })}
            </span>
          </div>
          <div className="overflow-hidden rounded-l border-[0.5px] border-border bg-card">
            {week.entries.flatMap(entry => buildAgendaRows(entry, grouping)).map(row => {
              const toneSpec = PRODUCER_TONES[row.entry.status];
              const meter =
                row.entry.mainSlots > 0
                  ? Array.from({ length: row.entry.mainSlots }, (_, i) => ({ filled: i < row.entry.confirmedMain }))
                  : [];
              const actionDef = actionForEntry(row.entry);
              const actionGate = actionDef ? actionGates?.[GATE_KEY_BY_ACTION[actionDef.action]] : undefined;
              const actionDisabled = actionGate?.disabled ?? false;

              return (
                <div
                  key={row.key}
                  data-testid={`agenda-row-${row.key}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenEntry(row.entry)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                      e.preventDefault();
                      onOpenEntry(row.entry);
                    }
                  }}
                  // Mobile-first: rows stack single-column (spec §4.5); `md:`
                  // restores the desktop single-line row exactly at >=768px
                  // (matching `useIsMobile`'s breakpoint) — every `md:`-only
                  // utility below reproduces a value this row already had.
                  className="flex cursor-pointer flex-col items-start gap-2 border-b-[0.5px] border-border px-3.5 py-3 last:border-b-0 hover:bg-muted md:flex-row md:items-center md:gap-3.5 md:py-2.5"
                >
                  <div className="shrink-0 md:w-[62px]">
                    <Eyebrow className="tracking-wide">{format(row.entry.date, 'EEE', { locale: dfLocale() })}</Eyebrow>
                    <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      {format(row.entry.date, 'd')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 md:w-[84px]">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.time}</span>
                    {row.extraSessions > 0 && (
                      <span className="inline-flex items-center rounded-xs bg-accent-50 px-1 text-eyebrow font-medium text-accent-text">
                        +{row.extraSessions}
                      </span>
                    )}
                  </div>
                  <div className="w-full min-w-0 md:flex-1">
                    <p className="truncate text-control font-semibold text-foreground">{row.entry.program}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[row.entry.venue, row.entry.city].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex w-full items-center gap-2 md:w-[150px] md:shrink-0">
                    {meter.length > 0 && <FillMeter segments={meter} tone={toneSpec.tone} />}
                    <span className={cn('font-mono text-eyebrow font-medium', TONE_TEXT[toneSpec.tone])}>
                      {t('calendar.agenda.mainFillCount', { filled: row.entry.confirmedMain, total: row.entry.mainSlots })}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'inline-flex h-5 w-24 shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 text-eyebrow font-medium',
                      toneSpec.badgeClass
                    )}
                  >
                    {t(`calendar.producerStatus.${row.entry.status}`)}
                  </span>
                  <div className="flex w-full justify-start md:w-[132px] md:shrink-0 md:justify-end">
                    {row.showAction &&
                      (actionDef ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`agenda-action-${row.entry.id}`}
                          disabled={actionDisabled}
                          title={actionDisabled ? actionGate?.title : undefined}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            onAction(row.entry, actionDef.action);
                          }}
                        >
                          {t(actionDef.i18nKey)}
                        </Button>
                      ) : (
                        row.entry.status === 'fully_filled' &&
                        row.entry.hireOrderId &&
                        row.entry.hireOrderStatus && (
                          <span data-testid={`agenda-order-status-${row.entry.id}`}>
                            <HireOrderStatusBadge status={row.entry.hireOrderStatus} />
                          </span>
                        )
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
