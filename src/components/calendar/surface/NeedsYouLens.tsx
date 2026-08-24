import type { MouseEvent } from 'react';
import { format } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { dfLocale } from '@/lib/dates';
import { filterNeedsYouQueueByScope, RISK_WINDOW_DAYS, type NeedsYouGroupKey, type NeedsYouItem, type NeedsYouQueue, type NeedsYouScopeKey } from '@/lib/calendar/needsYou';
import type { ActionGates, ProducerActionKey, Tone } from '@/lib/calendar/types';
import { PRODUCER_TONES, TONE_BG, TONE_TEXT } from '@/lib/calendar/tone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FillMeter } from './FillMeter';
import { QueueRail, type QueueShortlistArtist } from './QueueRail';

type TF = TFunction<'bookings'>;

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

/** Toast-label "kind" a "Cleared today" receipt is built from — mirrors the
 *  five `addReceipt` call sites in `ShowsBookingsPage`, each of which passes
 *  the `kind` matching its own action so the receipt's pill tone can be
 *  looked up directly instead of reverse-derived from the rendered label. */
export type NeedsYouReceiptKind = 'extended' | 'released' | 'notified' | 'confirmedAll' | 'generatedAll';

export interface NeedsYouReceipt {
  dateId: string;
  title: string;
  label: string;
  kind: NeedsYouReceiptKind;
}

interface NeedsYouLensProps {
  queue: NeedsYouQueue;
  /** Toolbar scope-chip filter (design gap-analysis §1) — narrows which
   *  groups render in the main list below to a single category; `'all'`
   *  (default) renders every group, unfiltered. Applied via
   *  `filterNeedsYouQueueByScope`, so the `layout==='stacked'` fold's
   *  internal `QueueRail` below keeps reading the unfiltered `queue` prop
   *  directly — the queue overview never narrows with the chip filter, only
   *  the group list does. */
  scope?: NeedsYouScopeKey;
  onItemAction: (item: NeedsYouItem, action: NeedsYouAction) => void;
  onOpenDate: (dateId: string) => void;
  onBulk: (group: NeedsYouGroupKey, action: 'confirm' | 'generate') => void;
  receipts: NeedsYouReceipt[];
  onUndoLast?: () => void;
  actionGates?: ActionGates;
  /** Where the `QueueRail` content (progress + shortlist + rules) renders
   *  relative to the groups. `'rail'` (default) renders nothing here — the
   *  caller composes `QueueRail` itself as a side rail (desktop, spec §3.4).
   *  `'stacked'` folds the same content below the groups as a collapsible
   *  section (mobile, spec §4.4), reusing `queue`/`receipts` and the two
   *  props below that only this layout consumes. */
  layout?: 'rail' | 'stacked';
  /** Eligible-artist shortlist for the queue's top at-risk date — mirrors
   *  `QueueRail`'s own `shortlist` prop. Only read when `layout==='stacked'`. */
  queueShortlist?: { dateId: string; dateLabel: string; artists: QueueShortlistArtist[] } | null;
  /** Mirrors `QueueRail`'s `onOffer`. Only read when `layout==='stacked'`. */
  onOfferArtist?: (dateId: string, artistId: string) => void;
  className?: string;
}

interface ActionMeta {
  action: NeedsYouAction;
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

const PRIMARY_ACTION: Record<NeedsYouGroupKey, ActionMeta> = {
  'expires-today': { action: 'confirm', gateKey: 'confirmHolds' },
  'at-risk': { action: 'open-casting', gateKey: 'openCasting' },
  'ready-to-issue': { action: 'generate', gateKey: 'generateHireOrder' },
  cancelled: { action: 'notify' },
};

const SECONDARY_ACTIONS: Record<NeedsYouGroupKey, ActionMeta[]> = {
  'expires-today': [{ action: 'extend' }, { action: 'release' }],
  'at-risk': [{ action: 'cancel-date' }],
  'ready-to-issue': [{ action: 'preview' }],
  cancelled: [{ action: 'undo-cancel' }],
};

/** Group-level bulk action, where applicable — omitted for groups with no
 *  bulk button (`at-risk`, `cancelled`). */
const BULK_ACTION: Partial<
  Record<NeedsYouGroupKey, { action: 'confirm' | 'generate'; gateKey: ProducerActionKey }>
> = {
  'expires-today': { action: 'confirm', gateKey: 'confirmHolds' },
  'ready-to-issue': { action: 'generate', gateKey: 'generateHireOrder' },
};

/** Group-header title color, matching the design's per-group `fg` (queueCard
 *  group builder, design line 947-950): violet for the most urgent group,
 *  then amber/green/red for at-risk/ready/cancelled — lets a producer scan
 *  the queue by color instead of reading every header. */
const GROUP_HEADER_CLASS: Record<NeedsYouGroupKey, string> = {
  'expires-today': 'text-accent-text',
  'at-risk': 'text-[var(--amber-600)]',
  'ready-to-issue': 'text-[var(--green-600)]',
  cancelled: 'text-[var(--red-600)]',
};

/** Toast-label "kind" a "Cleared today" receipt can be built from — mirrors
 *  the five `addReceipt` call sites in `ShowsBookingsPage`. Mapped to the
 *  tone of its colored pill: an extended hold is still a live, time-pressured
 *  state (warning); a released hold just returns to the pool, no verdict
 *  either way (muted); a cast notification is closer to a casting-style
 *  broadcast (accent, matching the design's violet "Casting opened" example);
 *  a bulk confirm or hire-order generation is an unambiguous positive outcome
 *  (success). */
const RECEIPT_TONE_BY_KIND: Record<NeedsYouReceiptKind, Tone> = {
  extended: 'warning',
  released: 'muted',
  notified: 'accent',
  confirmedAll: 'success',
  generatedAll: 'success',
};

function primaryLabel(group: NeedsYouGroupKey, item: NeedsYouItem, t: TF): string {
  switch (group) {
    case 'expires-today':
      return t('calendar.needsYou.primary.confirmHolds', { count: heldCount(item) });
    case 'at-risk':
      return t('calendar.needsYou.primary.openCasting');
    case 'ready-to-issue':
      return t('calendar.needsYou.primary.generateHireOrder');
    case 'cancelled':
      return t('calendar.needsYou.primary.notifyCast');
  }
}

function secondaryLabel(action: NeedsYouAction, t: TF): string {
  switch (action) {
    case 'extend':
      return t('calendar.needsYou.secondary.extend');
    case 'release':
      return t('calendar.needsYou.secondary.release');
    case 'cancel-date':
      return t('calendar.needsYou.secondary.cancelDate');
    case 'preview':
      return t('calendar.needsYou.secondary.preview');
    case 'undo-cancel':
      return t('calendar.needsYou.secondary.undoCancel');
    default:
      return '';
  }
}

function bulkLabel(group: NeedsYouGroupKey, count: number, t: TF): string {
  if (group === 'ready-to-issue') return t('calendar.needsYou.bulk.generateHireOrders', { count });
  return t('calendar.needsYou.bulk.confirmAll');
}

function noteForItem(item: NeedsYouItem, t: TF): string {
  switch (item.group) {
    case 'expires-today':
      return t('calendar.needsYou.note.expiresToday', { count: heldCount(item) });
    case 'at-risk': {
      const slots = t('calendar.needsYou.note.atRiskSlots', { count: item.openMainSlots });
      const lead =
        item.leadDays <= 0
          ? t('calendar.needsYou.note.atRiskLeadToday')
          : t('calendar.needsYou.note.atRiskLeadDays', { count: item.leadDays });
      return t('calendar.needsYou.note.atRisk', { slots, lead });
    }
    case 'ready-to-issue':
      return t('calendar.needsYou.note.readyToIssue');
    case 'cancelled':
      return t('calendar.needsYou.note.cancelled');
    default:
      return '';
  }
}

/** Optional "in Nd" / "today" lead-time line under the date block (design
 *  line 193-195), reusing the `at-risk` note's existing `atRiskLeadDays`/
 *  `atRiskLeadToday` translations rather than introducing new copy for what
 *  is the same "days from today" concept. Omitted for a past date. */
function leadLabel(leadDays: number, t: TF): string | null {
  if (leadDays > 0) return t('calendar.needsYou.note.atRiskLeadDays', { count: leadDays });
  if (leadDays === 0) return t('calendar.needsYou.note.atRiskLeadToday');
  return null;
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
 * receipts with an "Undo last" control. When `layout==='stacked'` (mobile,
 * spec §4.4), the `QueueRail` content folds below the groups as a
 * collapsible "Queue overview" section instead of the caller composing it as
 * a side rail — `layout==='rail'` (default, desktop) renders nothing extra
 * here and leaves that composition to the caller, unchanged. Purely
 * presentational.
 */
export function NeedsYouLens({
  queue,
  scope = 'all',
  onItemAction,
  onOpenDate,
  onBulk,
  receipts,
  onUndoLast,
  actionGates,
  layout = 'rail',
  queueShortlist = null,
  onOfferArtist,
  className,
}: NeedsYouLensProps) {
  const { t } = useTranslation('bookings');
  const visibleGroups = filterNeedsYouQueueByScope(queue, scope).groups;

  return (
    <div data-testid="needs-you-lens" className={cn('flex flex-col gap-5', className)}>
      {visibleGroups.map((group) => {
        const bulk = BULK_ACTION[group.key];
        const bulkGate = bulk ? actionGates?.[bulk.gateKey] : undefined;
        const bulkDisabled = bulkGate?.disabled ?? false;

        return (
          <div key={group.key} data-testid={`needs-you-group-${group.key}`}>
            <div className="flex items-baseline justify-between gap-2 pb-2">
              <p
                data-testid={`needs-you-group-title-${group.key}`}
                // eslint-disable-next-line no-restricted-syntax -- needs a data-testid, which <Eyebrow> (no pass-through props) can't carry
                className={cn('text-eyebrow font-semibold uppercase tracking-[1.6px]', GROUP_HEADER_CLASS[group.key])}
              >
                {t(`calendar.needsYou.groups.${group.key}`, { days: RISK_WINDOW_DAYS })}
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
                  {bulkLabel(group.key, group.items.length, t)}
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
                // Only `expires-today` gets the design's violet-tinted date
                // block + the heavier shadow-3 elevation (gap-analysis §2
                // "Urgent-card distinct styling") — every other group keeps
                // the neutral card treatment.
                const isUrgent = group.key === 'expires-today';
                const lead = leadLabel(item.leadDays, t);

                return (
                  <div
                    key={item.dateId}
                    data-testid={`needs-you-item-${item.dateId}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDate(item.dateId)}
                    className={cn(
                      'flex cursor-pointer flex-col overflow-hidden rounded-[var(--radius-xl)] border-[0.5px] bg-card md:flex-row md:items-stretch',
                      isUrgent
                        ? 'border-[var(--accent-200)] shadow-elev3'
                        : 'border-border shadow-elev2'
                    )}
                  >
                    {/* 1. Date block — weekday / big day number / month, optional lead-time line. */}
                    <div
                      data-testid={`needs-you-date-${item.dateId}`}
                      className={cn(
                        'flex shrink-0 flex-row items-center gap-3 border-b-[0.5px] border-border px-4 py-3 text-left',
                        'md:w-[92px] md:flex-col md:items-center md:justify-center md:gap-0.5 md:border-b-0 md:border-r-[0.5px] md:px-0 md:py-4 md:text-center',
                        isUrgent ? 'bg-accent-tint' : 'bg-well-tint'
                      )}
                    >
                      <Eyebrow className={isUrgent ? 'text-primary-hover' : undefined}>
                        {format(item.entry.date, 'EEE', { locale: dfLocale() })}
                      </Eyebrow>
                      <p
                        className={cn(
                          'font-mono text-display-sm font-semibold leading-8 tabular-nums',
                          isUrgent ? 'text-accent-text' : 'text-foreground'
                        )}
                      >
                        {format(item.entry.date, 'd')}
                      </p>
                      <p className="text-eyebrow text-muted-foreground">
                        {format(item.entry.date, 'MMM', { locale: dfLocale() })}
                      </p>
                      {lead && <p className="font-mono text-eyebrow text-[var(--text-faint)] md:mt-1.5">{lead}</p>}
                    </div>

                    {/* 2. Content column — eyebrow+countdown, title, detail, meter, people, note. */}
                    <div className="min-w-0 flex-1 px-4 py-3.5">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Eyebrow className={TONE_TEXT[toneSpec.tone]}>
                          {t(`calendar.producerStatus.${item.entry.status}`)}
                        </Eyebrow>
                        {item.group === 'expires-today' && item.earliestExpiry && (
                          <span
                            data-testid={`needs-you-expiry-${item.dateId}`}
                            className="font-mono text-eyebrow font-medium text-[var(--red-600)]"
                          >
                            {t('calendar.needsYou.expires', { time: format(item.earliestExpiry, 'HH:mm') })}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-title-sm font-semibold tracking-[-0.1px] text-foreground">
                        {entryTitle(item)}
                      </p>
                      {entryDetail(item) && (
                        <p className="mt-0.5 truncate text-control text-muted-foreground">{entryDetail(item)}</p>
                      )}

                      {meter.length > 0 && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <FillMeter segments={meter} tone={toneSpec.tone} />
                          <span className="font-mono text-caption font-medium text-muted-foreground">
                            {item.entry.confirmedMain}/{item.entry.mainSlots}
                          </span>
                        </div>
                      )}

                      {item.people.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {item.people.map((person) => (
                            <span
                              key={person.artistId}
                              data-testid={`needs-you-person-${item.dateId}-${person.artistId}`}
                              className="inline-flex items-center rounded-pill bg-well-tint px-2 py-0.5 text-eyebrow font-medium text-foreground"
                            >
                              {person.name}
                              {person.isUnderstudy ? ` (${t('calendar.needsYou.understudyAbbrev')})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="mt-2.5 text-xs text-muted-foreground">{noteForItem(item, t)}</p>
                    </div>

                    {/* 3. Action column — primary (full width), up to 2 secondary side by side. */}
                    <div
                      className={cn(
                        'flex shrink-0 flex-col justify-center gap-2 border-t-[0.5px] border-border px-4 py-3.5',
                        'md:w-[232px] md:border-l-[0.5px] md:border-t-0',
                        isUrgent ? 'bg-card' : 'bg-well-tint'
                      )}
                    >
                      <Button
                        type="button"
                        className="w-full"
                        data-testid={`needs-you-primary-${item.dateId}`}
                        disabled={primaryDisabled}
                        title={primaryDisabled ? primaryGate?.title : undefined}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation();
                          onItemAction(item, primary.action);
                        }}
                      >
                        {primaryLabel(group.key, item, t)}
                      </Button>
                      {secondary.length > 0 && (
                        <div className="flex gap-2">
                          {secondary.map((spec) => (
                            <Button
                              key={spec.action}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              data-testid={`needs-you-secondary-${item.dateId}-${spec.action}`}
                              onClick={(event: MouseEvent) => {
                                event.stopPropagation();
                                onItemAction(item, spec.action);
                              }}
                            >
                              {secondaryLabel(spec.action, t)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {layout === 'stacked' && (
        <Collapsible defaultOpen data-testid="needs-you-queue-fold">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid="needs-you-queue-fold-trigger"
              className="group flex w-full items-center justify-between gap-2 rounded-control border border-border bg-card px-3.5 py-2.5 text-left"
            >
              {/* eslint-disable-next-line no-restricted-syntax -- inline <span> inside a <button>; <Eyebrow> renders a block <p>, invalid button content */}
              <span className="text-eyebrow font-semibold uppercase tracking-[1.6px] text-muted-foreground">
                {t('calendar.needsYou.queueOverview')}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <QueueRail
              queue={queue}
              clearedToday={receipts.length}
              shortlist={queueShortlist}
              onOffer={onOfferArtist}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      <div data-testid="needs-you-receipts" className="overflow-hidden rounded-card border-[0.5px] border-border bg-well-tint">
        <div className="flex items-center gap-2 border-b-[0.5px] border-border px-3.5 py-2.5">
          <Eyebrow>{t('calendar.needsYou.clearedToday')}</Eyebrow>
          <span className="font-mono text-eyebrow text-muted-foreground">{receipts.length}</span>
          <button
            type="button"
            className="ml-auto text-control font-medium text-accent-text hover:underline disabled:pointer-events-none disabled:opacity-50"
            data-testid="needs-you-undo-last"
            disabled={receipts.length === 0}
            onClick={() => onUndoLast?.()}
          >
            {t('calendar.needsYou.undoLast')}
          </button>
        </div>
        {receipts.map((receipt, i) => {
          const tone = RECEIPT_TONE_BY_KIND[receipt.kind];
          return (
            <div
              key={`${receipt.dateId}-${i}`}
              data-testid={`needs-you-receipt-${i}`}
              className="flex items-center gap-3 border-b-[0.5px] border-border/60 px-3.5 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-control font-medium text-foreground">{receipt.title}</span>
              <span
                data-testid={`needs-you-receipt-pill-${i}`}
                className={cn(
                  'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-chip px-1.5 text-eyebrow font-medium',
                  TONE_BG[tone],
                  TONE_TEXT[tone]
                )}
              >
                {receipt.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
