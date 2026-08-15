import type { MouseEvent } from 'react';
import { format } from 'date-fns';
import { NEEDS_YOU_GROUP_LABELS } from '@/lib/calendar/needsYou';
import type { NeedsYouGroupKey, NeedsYouItem, NeedsYouQueue } from '@/lib/calendar/needsYou';
import type { ActionGates, ProducerActionKey } from '@/lib/calendar/types';
import { PRODUCER_TONES } from '@/lib/calendar/tone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FillMeter } from './FillMeter';

/** Every action a "Needs you" card (or its group's bulk button) can fire.
 *  `confirm` covers both the per-item "Confirm N holds" primary and the
 *  `expires-today` group's "Confirm all" bulk button; `generate` covers both
 *  the per-item "Generate hire order" primary and the `ready-to-issue`
 *  group's "Generate N hire orders" bulk button. */
export type NeedsYouAction =
  | 'confirm' // Confirm N holds (expires-today) / Confirm holds
  | 'extend' // Extend 24h
  | 'release' // Release (bulkDeclineSoftBooked)
  | 'open-casting' // Open casting (at-risk)
  | 'cancel-date' // Cancel date (at-risk secondary)
  | 'generate' // Generate hire order (ready-to-issue)
  | 'preview' // Preview (ready-to-issue secondary)
  | 'notify' // Notify cast (cancelled)
  | 'undo-cancel'; // Undo cancel (cancelled secondary)

interface NeedsYouReceipt {
  dateId: string;
  title: string;
  label: string;
}

interface NeedsYouLensProps {
  queue: NeedsYouQueue;
  onItemAction: (item: NeedsYouItem, action: NeedsYouAction) => void;
  onOpenDate: (dateId: string) => void;
  onBulk: (group: NeedsYouGroupKey, action: 'confirm' | 'generate') => void;
  receipts: NeedsYouReceipt[];
  onUndoLast?: () => void;
  actionGates?: ActionGates;
  className?: string;
}

interface ActionSpec {
  action: NeedsYouAction;
  label: (item: NeedsYouItem) => string;
  /** Maps to the shared `ActionGates` key, when this action is one of the
   *  three capability-gated producer actions. Secondary actions here
   *  (extend/release/cancel-date/preview/undo-cancel) have no gate key —
   *  `ActionGates` only covers confirm/generate/open-casting. */
  gateKey?: ProducerActionKey;
}

/** "Held" = the artist still has a live offer or hold on this date (as
 *  opposed to already confirmed, or cancelled off the date). Drives the
 *  "Confirm N holds" primary label on an `expires-today` card. */
function heldCount(item: NeedsYouItem): number {
  return item.people.filter((p) => p.status === 'suggested' || p.status === 'soft_booked').length;
}

function plural(count: number, singular: string, plural_: string): string {
  return count === 1 ? singular : plural_;
}

const PRIMARY_ACTION: Record<NeedsYouGroupKey, ActionSpec> = {
  'expires-today': {
    action: 'confirm',
    label: (item) => `Confirm ${heldCount(item)} hold${plural(heldCount(item), '', 's')}`,
    gateKey: 'confirmHolds',
  },
  'at-risk': {
    action: 'open-casting',
    label: () => 'Open casting',
    gateKey: 'openCasting',
  },
  'ready-to-issue': {
    action: 'generate',
    label: () => 'Generate hire order',
    gateKey: 'generateHireOrder',
  },
  cancelled: {
    action: 'notify',
    label: () => 'Notify cast',
  },
};

const SECONDARY_ACTIONS: Record<NeedsYouGroupKey, ActionSpec[]> = {
  'expires-today': [
    { action: 'extend', label: () => 'Extend 24h' },
    { action: 'release', label: () => 'Release' },
  ],
  'at-risk': [{ action: 'cancel-date', label: () => 'Cancel date' }],
  'ready-to-issue': [{ action: 'preview', label: () => 'Preview' }],
  cancelled: [{ action: 'undo-cancel', label: () => 'Undo cancel' }],
};

/** Group-level bulk action, where applicable — `null` for groups with no
 *  bulk button (`at-risk`, `cancelled`). */
const BULK_ACTION: Partial<
  Record<NeedsYouGroupKey, { action: 'confirm' | 'generate'; label: (count: number) => string; gateKey: ProducerActionKey }>
> = {
  'expires-today': { action: 'confirm', label: () => 'Confirm all', gateKey: 'confirmHolds' },
  'ready-to-issue': {
    action: 'generate',
    label: (count) => `Generate ${count} hire order${plural(count, '', 's')}`,
    gateKey: 'generateHireOrder',
  },
};

function noteForItem(item: NeedsYouItem): string {
  switch (item.group) {
    case 'expires-today': {
      const held = heldCount(item);
      return `${held} held ${plural(held, 'artist', 'artists')} will lose their offer if not confirmed today.`;
    }
    case 'at-risk': {
      const slots = `${item.openMainSlots} open slot${plural(item.openMainSlots, '', 's')}`;
      const lead = item.leadDays <= 0 ? 'today' : `in ${item.leadDays} day${plural(item.leadDays, '', 's')}`;
      return `${slots}, ${lead}.`;
    }
    case 'ready-to-issue':
      return 'Cast is confirmed and ready for its hire order.';
    case 'cancelled':
      return 'The cast has not been notified about this cancellation yet.';
    default:
      return '';
  }
}

function entryTitle(item: NeedsYouItem): string {
  const { entry } = item;
  return entry.program + (entry.subProgram ? ` · ${entry.subProgram}` : '');
}

function entryDetail(item: NeedsYouItem): string {
  const { entry } = item;
  return [entry.venue, entry.city].filter(Boolean).join(' · ');
}

/**
 * Producer "Needs you" grouped-card queue (spec §4.1): each non-empty
 * `queue.groups` entry renders as a titled section — an optional group-level
 * bulk button (`expires-today` → Confirm all, `ready-to-issue` → Generate N
 * hire orders) plus one card per `NeedsYouItem`. A card shows the date's
 * title/detail, a fill meter, people chips, a group-specific note, and a
 * primary + secondary action row mapped to `NeedsYouAction`. The
 * `expires-today` group additionally shows an expiry-time chip — gated on
 * `item.group === 'expires-today'`, never on `earliestExpiry` alone, since
 * `buildNeedsYouQueue` computes `earliestExpiry` unconditionally and it can
 * be non-null on a non-`expires-today` item in an edge case. Clicking a card
 * (outside its buttons) opens that date; the footer lists today's cleared
 * receipts with an "Undo last" control. Purely presentational.
 */
export function NeedsYouLens({
  queue,
  onItemAction,
  onOpenDate,
  onBulk,
  receipts,
  onUndoLast,
  actionGates,
  className,
}: NeedsYouLensProps) {
  return (
    <div data-testid="needs-you-lens" className={cn('flex flex-col gap-5', className)}>
      {queue.groups.map((group) => {
        const bulk = BULK_ACTION[group.key];
        const bulkGate = bulk ? actionGates?.[bulk.gateKey] : undefined;
        const bulkDisabled = bulkGate?.disabled ?? false;

        return (
          <div key={group.key} data-testid={`needs-you-group-${group.key}`}>
            <div className="flex items-baseline justify-between gap-2 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-primary">
                {NEEDS_YOU_GROUP_LABELS[group.key]}
              </p>
              {bulk && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`needs-you-bulk-${group.key}`}
                  disabled={bulkDisabled}
                  title={bulkDisabled ? bulkGate?.title : undefined}
                  onClick={() => onBulk(group.key, bulk.action)}
                >
                  {bulk.label(group.items.length)}
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              {group.items.map((item) => {
                const toneSpec = PRODUCER_TONES[item.entry.status];
                const meter =
                  item.entry.mainSlots > 0
                    ? Array.from({ length: item.entry.mainSlots }, (_, i) => ({ filled: i < item.entry.confirmedMain }))
                    : [];
                const primary = PRIMARY_ACTION[group.key];
                const secondary = SECONDARY_ACTIONS[group.key];
                const primaryGate = primary.gateKey ? actionGates?.[primary.gateKey] : undefined;
                const primaryDisabled = primaryGate?.disabled ?? false;

                return (
                  <div
                    key={item.dateId}
                    data-testid={`needs-you-item-${item.dateId}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDate(item.dateId)}
                    className="flex cursor-pointer flex-col gap-2.5 rounded-m border border-border bg-card p-3.5 hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13.5px] font-semibold text-foreground">{entryTitle(item)}</p>
                          <span
                            className={cn(
                              'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 text-[11px] font-medium',
                              toneSpec.badgeClass
                            )}
                          >
                            {toneSpec.label}
                          </span>
                          {item.group === 'expires-today' && item.earliestExpiry && (
                            <span
                              data-testid={`needs-you-expiry-${item.dateId}`}
                              className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive"
                            >
                              Expires {format(item.earliestExpiry, 'HH:mm')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {format(item.entry.date, 'EEE d MMM')}
                          {entryDetail(item) ? ` · ${entryDetail(item)}` : ''}
                        </p>
                      </div>
                      {meter.length > 0 && (
                        <div className="flex shrink-0 items-center gap-2">
                          <FillMeter segments={meter} tone={toneSpec.tone} />
                          <span className="font-mono text-[11px] font-medium text-muted-foreground">
                            {item.entry.confirmedMain}/{item.entry.mainSlots}
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">{noteForItem(item)}</p>

                    {item.people.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.people.map((person) => (
                          <span
                            key={person.artistId}
                            data-testid={`needs-you-person-${item.dateId}-${person.artistId}`}
                            className="inline-flex items-center rounded-pill bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                          >
                            {person.name}
                            {person.isUnderstudy ? ' (US)' : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        data-testid={`needs-you-primary-${item.dateId}`}
                        disabled={primaryDisabled}
                        title={primaryDisabled ? primaryGate?.title : undefined}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation();
                          onItemAction(item, primary.action);
                        }}
                      >
                        {primary.label(item)}
                      </Button>
                      {secondary.map((spec) => (
                        <Button
                          key={spec.action}
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`needs-you-secondary-${item.dateId}-${spec.action}`}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            onItemAction(item, spec.action);
                          }}
                        >
                          {spec.label(item)}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div data-testid="needs-you-receipts" className="overflow-hidden rounded-m border border-border bg-muted">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            Cleared today
          </p>
          <span className="font-mono text-[11px] text-muted-foreground">{receipts.length}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-auto p-0 text-xs font-medium text-primary hover:bg-transparent"
            data-testid="needs-you-undo-last"
            disabled={receipts.length === 0}
            onClick={() => onUndoLast?.()}
          >
            Undo last
          </Button>
        </div>
        {receipts.map((receipt, i) => (
          <div
            key={`${receipt.dateId}-${i}`}
            data-testid={`needs-you-receipt-${i}`}
            className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{receipt.title}</span>
            <span className="truncate text-xs text-muted-foreground">{receipt.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
