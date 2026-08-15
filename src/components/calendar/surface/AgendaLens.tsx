import type { MouseEvent } from 'react';
import { format, startOfWeek } from 'date-fns';
import type { ActionGates, ProducerActionKey, ProducerDateEntry, ProducerStatus } from '@/lib/calendar/types';
import { PRODUCER_TONES, TONE_TEXT } from '@/lib/calendar/tone';
import { toDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HireOrderStatusBadge } from '@/components/hireOrders/HireOrderStatusBadge';
import { FillMeter } from './FillMeter';

export type AgendaAction = 'generate' | 'confirm' | 'open';

/** Contextual action per date status (task 12 brief): only these three
 *  statuses carry a row action — cancelled/unconfigured dates get none. A
 *  `fully_filled` date only offers Generate when it has no active order yet
 *  (`hireOrderId == null`); an already-ordered date gets no action here — the
 *  row instead renders its order status badge in the action column. */
const ACTION_BY_STATUS: Partial<Record<ProducerStatus, { label: string; action: AgendaAction }>> = {
  fully_filled: { label: 'Generate hire order', action: 'generate' },
  partially_filled: { label: 'Confirm holds', action: 'confirm' },
  open: { label: 'Open casting', action: 'open' },
};

function actionForEntry(entry: ProducerDateEntry): { label: string; action: AgendaAction } | undefined {
  if (entry.status === 'fully_filled' && entry.hireOrderId != null) return undefined;
  return ACTION_BY_STATUS[entry.status];
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
  onOpenDay: (day: Date) => void;
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
 * action button (`ACTION_BY_STATUS`). Clicking the row opens the date;
 * clicking the action button fires `onAction` instead (its click does not
 * bubble into the row's `onOpenDay`).
 */
export function AgendaLens({ entries, onOpenDay, onAction, actionGates, className }: AgendaLensProps) {
  const weeks = groupByWeek(entries);

  return (
    <div data-testid="agenda-lens" className={cn('flex flex-col gap-5', className)}>
      {weeks.map(week => (
        <div key={week.key} data-testid={`agenda-week-${week.key}`}>
          <div className="flex items-baseline gap-2.5 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-primary">
              Week of {format(week.weekStart, 'd MMM')}
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">
              {week.entries.length} date{week.entries.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-hidden rounded-m border border-border bg-card">
            {week.entries.map(entry => {
              const toneSpec = PRODUCER_TONES[entry.status];
              const meter =
                entry.mainSlots > 0
                  ? Array.from({ length: entry.mainSlots }, (_, i) => ({ filled: i < entry.confirmedMain }))
                  : [];
              const actionDef = actionForEntry(entry);
              const actionGate = actionDef ? actionGates?.[GATE_KEY_BY_ACTION[actionDef.action]] : undefined;
              const actionDisabled = actionGate?.disabled ?? false;

              return (
                <div
                  key={entry.id}
                  data-testid={`agenda-row-${entry.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenDay(entry.date)}
                  className="flex cursor-pointer items-center gap-3.5 border-b border-border px-3.5 py-2.5 last:border-b-0 hover:bg-muted/50"
                >
                  <div className="w-[62px] shrink-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {format(entry.date, 'EEE')}
                    </p>
                    <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      {format(entry.date, 'd')}
                    </p>
                  </div>
                  <span className="w-[46px] shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {entry.session1 ?? ''}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-foreground">{entry.program}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[entry.venue, entry.city].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex w-[150px] shrink-0 items-center gap-2">
                    {meter.length > 0 && <FillMeter segments={meter} tone={toneSpec.tone} />}
                    <span className={cn('font-mono text-[11px] font-medium', TONE_TEXT[toneSpec.tone])}>
                      {entry.confirmedMain}/{entry.mainSlots} main
                    </span>
                  </div>
                  <span
                    className={cn(
                      'inline-flex h-5 w-24 shrink-0 items-center whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium',
                      toneSpec.badgeClass
                    )}
                  >
                    {toneSpec.label}
                  </span>
                  <div className="flex w-[132px] shrink-0 justify-end">
                    {actionDef ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid={`agenda-action-${entry.id}`}
                        disabled={actionDisabled}
                        title={actionDisabled ? actionGate?.title : undefined}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation();
                          onAction(entry, actionDef.action);
                        }}
                      >
                        {actionDef.label}
                      </Button>
                    ) : (
                      entry.status === 'fully_filled' &&
                      entry.hireOrderId &&
                      entry.hireOrderStatus && (
                        <span data-testid={`agenda-order-status-${entry.id}`}>
                          <HireOrderStatusBadge status={entry.hireOrderStatus} />
                        </span>
                      )
                    )}
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
