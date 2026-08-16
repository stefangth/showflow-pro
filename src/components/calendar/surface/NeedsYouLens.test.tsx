import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NeedsYouLens } from './NeedsYouLens';
import type { NeedsYouItem, NeedsYouQueue } from '@/lib/calendar/needsYou';
import type { ProducerDateEntry } from '@/lib/calendar/types';

function makeEntry(overrides: Partial<ProducerDateEntry> & Pick<ProducerDateEntry, 'id' | 'date'>): ProducerDateEntry {
  return {
    program: 'Aida',
    subProgram: null,
    venue: 'Opera House',
    city: 'Berlin',
    session1: '19:00',
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 4,
    confirmedMain: 2,
    acceptedMain: 0,
    pendingMain: 2,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    castNotifiedAt: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<NeedsYouItem> & Pick<NeedsYouItem, 'dateId' | 'entry' | 'group'>): NeedsYouItem {
  return {
    people: [],
    earliestExpiry: null,
    openMainSlots: 0,
    leadDays: 3,
    ...overrides,
  };
}

describe('NeedsYouLens', () => {
  it('renders expires-today and ready-to-issue sections, fires bulk + item actions, and gates the expiry chip on the group key', () => {
    const expiresEntry = makeEntry({ id: 'd-expires', date: new Date(2026, 7, 15), status: 'partially_filled' });
    const expiresItem = makeItem({
      dateId: 'd-expires',
      entry: expiresEntry,
      group: 'expires-today',
      earliestExpiry: new Date(2026, 7, 15, 18, 0),
      people: [
        { artistId: 'a-1', name: 'Jo Reyes', status: 'soft_booked', isUnderstudy: false },
        { artistId: 'a-2', name: 'Mika Sol', status: 'suggested', isUnderstudy: false },
      ],
    });

    const readyEntry = makeEntry({ id: 'd-ready', date: new Date(2026, 7, 18), status: 'fully_filled', confirmedMain: 4, pendingMain: 0 });
    // Fabricated: a ready-to-issue item with a stray non-null earliestExpiry.
    // `needsYou.ts` computes earliestExpiry unconditionally, so a ready item
    // can carry a non-null value even though it isn't expires-today — the
    // expiry chip must gate on `item.group`, never on earliestExpiry alone.
    const readyItem = makeItem({
      dateId: 'd-ready',
      entry: readyEntry,
      group: 'ready-to-issue',
      earliestExpiry: new Date(2026, 7, 18, 20, 0),
    });

    const queue: NeedsYouQueue = {
      groups: [
        { key: 'expires-today', items: [expiresItem] },
        { key: 'ready-to-issue', items: [readyItem] },
      ],
      totalItems: 2,
      countByGroup: { 'expires-today': 1, 'at-risk': 0, 'ready-to-issue': 1, cancelled: 0 },
    };

    const onItemAction = vi.fn();
    const onOpenDate = vi.fn();
    const onBulk = vi.fn();
    const onUndoLast = vi.fn();

    render(
      <NeedsYouLens
        queue={queue}
        onItemAction={onItemAction}
        onOpenDate={onOpenDate}
        onBulk={onBulk}
        receipts={[{ dateId: 'd-cleared', title: 'Cirque Noir', label: 'Confirmed holds' }]}
        onUndoLast={onUndoLast}
      />
    );

    expect(screen.getByTestId('needs-you-group-expires-today')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-ready-to-issue')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-item-d-expires')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-item-d-ready')).toBeInTheDocument();

    // People chips render for the expires-today item.
    expect(screen.getByText('Jo Reyes')).toBeInTheDocument();
    expect(screen.getByText('Mika Sol')).toBeInTheDocument();

    // Expiry chip gates on group === 'expires-today', not on earliestExpiry alone.
    expect(screen.getByTestId('needs-you-expiry-d-expires')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-you-expiry-d-ready')).not.toBeInTheDocument();

    // Urgent-card styling (3-column ticket, gap-analysis §2): only the
    // expires-today card gets the violet border + shadow-3 elevation + the
    // violet-tinted date block; the ready-to-issue card stays neutral.
    expect(screen.getByTestId('needs-you-item-d-expires')).toHaveClass(
      'border-[var(--accent-200)]',
      'shadow-elev3'
    );
    expect(screen.getByTestId('needs-you-date-d-expires')).toHaveClass('bg-accent-50');
    expect(screen.getByTestId('needs-you-item-d-ready')).toHaveClass('border-border', 'shadow-elev2');
    expect(screen.getByTestId('needs-you-date-d-ready')).toHaveClass('bg-muted');

    // Group headers are color-coded per group key, not all the same violet.
    expect(screen.getByTestId('needs-you-group-title-expires-today')).toHaveClass('text-accent-700');
    expect(screen.getByTestId('needs-you-group-title-ready-to-issue')).toHaveClass('text-[var(--green-600)]');

    // Bulk button for expires-today fires onBulk('expires-today', 'confirm').
    fireEvent.click(screen.getByTestId('needs-you-bulk-expires-today'));
    expect(onBulk).toHaveBeenCalledTimes(1);
    expect(onBulk).toHaveBeenCalledWith('expires-today', 'confirm');

    // The ready item's primary action fires onItemAction(item, 'generate').
    fireEvent.click(screen.getByTestId('needs-you-primary-d-ready'));
    expect(onItemAction).toHaveBeenCalledTimes(1);
    expect(onItemAction).toHaveBeenCalledWith(readyItem, 'generate');

    // Receipts footer: a receipt row + "Undo last" fires onUndoLast, and the
    // receipt renders as a colored tone pill (not flat gray text) — this
    // fixture's "Confirmed holds" label matches the confirmedAll toast
    // template, so it resolves to the success tone's classes.
    expect(screen.getByTestId('needs-you-receipts')).toBeInTheDocument();
    expect(screen.getByText('Cirque Noir')).toBeInTheDocument();
    const pill = screen.getByTestId('needs-you-receipt-pill-0');
    expect(pill).toHaveTextContent('Confirmed holds');
    expect(pill).toHaveClass('bg-[var(--green-100)]', 'text-[var(--green-600)]');
    fireEvent.click(screen.getByTestId('needs-you-undo-last'));
    expect(onUndoLast).toHaveBeenCalledTimes(1);
  });

  it('fires onOpenDate when a card is clicked, but not when an action button inside it is clicked', () => {
    const entry = makeEntry({ id: 'd-atrisk', date: new Date(2026, 7, 20), status: 'partially_filled' });
    const item = makeItem({ dateId: 'd-atrisk', entry, group: 'at-risk', openMainSlots: 2, leadDays: 5 });
    const queue: NeedsYouQueue = {
      groups: [{ key: 'at-risk', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };
    const onOpenDate = vi.fn();
    const onItemAction = vi.fn();

    render(
      <NeedsYouLens
        queue={queue}
        onItemAction={onItemAction}
        onOpenDate={onOpenDate}
        onBulk={vi.fn()}
        receipts={[]}
      />
    );

    fireEvent.click(screen.getByTestId('needs-you-primary-d-atrisk'));
    expect(onItemAction).toHaveBeenCalledWith(item, 'open-casting');
    expect(onOpenDate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('needs-you-item-d-atrisk'));
    expect(onOpenDate).toHaveBeenCalledTimes(1);
    expect(onOpenDate).toHaveBeenCalledWith('d-atrisk');
  });

  it('gates the primary button via actionGates and shows the disabled tooltip', () => {
    const entry = makeEntry({ id: 'd-ready-2', date: new Date(2026, 7, 21), status: 'fully_filled' });
    const item = makeItem({ dateId: 'd-ready-2', entry, group: 'ready-to-issue' });
    const queue: NeedsYouQueue = {
      groups: [{ key: 'ready-to-issue', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 0, 'ready-to-issue': 1, cancelled: 0 },
    };
    const onItemAction = vi.fn();

    render(
      <NeedsYouLens
        queue={queue}
        onItemAction={onItemAction}
        onOpenDate={vi.fn()}
        onBulk={vi.fn()}
        receipts={[]}
        actionGates={{ generateHireOrder: { disabled: true, title: 'No capability' } }}
      />
    );

    const button = screen.getByTestId('needs-you-primary-d-ready-2');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'No capability');
    fireEvent.click(button);
    expect(onItemAction).not.toHaveBeenCalled();
  });

  it('default layout ("rail") renders no QueueRail content — the caller composes it as a side rail', () => {
    const entry = makeEntry({ id: 'd-atrisk', date: new Date(2026, 7, 20), status: 'partially_filled' });
    const item = makeItem({ dateId: 'd-atrisk', entry, group: 'at-risk' });
    const queue: NeedsYouQueue = {
      groups: [{ key: 'at-risk', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };

    render(<NeedsYouLens queue={queue} onItemAction={vi.fn()} onOpenDate={vi.fn()} onBulk={vi.fn()} receipts={[]} />);

    expect(screen.queryByTestId('queue-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('needs-you-queue-fold')).not.toBeInTheDocument();
  });

  it('layout="stacked" folds the QueueRail content below the groups (not aside), reusing queue + receipts', () => {
    const entry = makeEntry({ id: 'd-atrisk', date: new Date(2026, 7, 20), status: 'partially_filled' });
    const item = makeItem({ dateId: 'd-atrisk', entry, group: 'at-risk', openMainSlots: 2, leadDays: 1 });
    const queue: NeedsYouQueue = {
      groups: [{ key: 'at-risk', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };

    render(
      <NeedsYouLens
        queue={queue}
        onItemAction={vi.fn()}
        onOpenDate={vi.fn()}
        onBulk={vi.fn()}
        receipts={[{ dateId: 'd-cleared', title: 'Cirque Noir', label: 'Confirmed' }]}
        layout="stacked"
        queueShortlist={{ dateId: 'd-atrisk', dateLabel: 'Thu 20 Aug', artists: [{ artistId: 'a-1', name: 'Jo Reyes' }] }}
      />
    );

    const group = screen.getByTestId('needs-you-group-at-risk');
    const rail = screen.getByTestId('queue-rail');
    expect(rail).toBeInTheDocument();
    // "below the groups, not aside": the rail follows the group in DOM order.
    expect(group.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // QueueRail content is real, not a stub — reuses queue + receipts.length.
    expect(screen.getByTestId('queue-rail-progress')).toHaveTextContent('1 cleared today');
    expect(screen.getByText('Jo Reyes')).toBeInTheDocument();
  });

  it('layout="stacked" fires onOfferArtist from the folded shortlist', () => {
    const entry = makeEntry({ id: 'd-atrisk', date: new Date(2026, 7, 20), status: 'partially_filled' });
    const item = makeItem({ dateId: 'd-atrisk', entry, group: 'at-risk' });
    const queue: NeedsYouQueue = {
      groups: [{ key: 'at-risk', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };
    const onOfferArtist = vi.fn();

    render(
      <NeedsYouLens
        queue={queue}
        onItemAction={vi.fn()}
        onOpenDate={vi.fn()}
        onBulk={vi.fn()}
        receipts={[]}
        layout="stacked"
        queueShortlist={{ dateId: 'd-atrisk', dateLabel: 'Thu 20 Aug', artists: [{ artistId: 'a-1', name: 'Jo Reyes' }] }}
        onOfferArtist={onOfferArtist}
      />
    );

    fireEvent.click(screen.getByTestId('queue-offer-a-1'));
    expect(onOfferArtist).toHaveBeenCalledWith('d-atrisk', 'a-1');
  });

  it('scope narrows the visible groups; the stacked layout\'s folded QueueRail overview stays unfiltered', () => {
    const atRiskEntry = makeEntry({ id: 'd-atrisk', date: new Date(2026, 7, 20), status: 'partially_filled' });
    const cancelledEntry = makeEntry({ id: 'd-cancelled', date: new Date(2026, 7, 22), status: 'cancelled' });
    const atRiskItem = makeItem({ dateId: 'd-atrisk', entry: atRiskEntry, group: 'at-risk' });
    const cancelledItem = makeItem({ dateId: 'd-cancelled', entry: cancelledEntry, group: 'cancelled' });
    const queue: NeedsYouQueue = {
      groups: [
        { key: 'at-risk', items: [atRiskItem] },
        { key: 'cancelled', items: [cancelledItem] },
      ],
      totalItems: 2,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 1 },
    };

    const { rerender } = render(
      <NeedsYouLens
        queue={queue}
        scope="cancelled"
        onItemAction={vi.fn()}
        onOpenDate={vi.fn()}
        onBulk={vi.fn()}
        receipts={[]}
        layout="stacked"
      />
    );

    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-you-group-at-risk')).not.toBeInTheDocument();
    // The folded overview's breakdown still reports both groups — it always
    // reads the unfiltered `queue` prop, never the scope-narrowed list.
    const overview = screen.getByTestId('queue-rail-progress');
    expect(overview).toHaveTextContent('At risk of running short');
    expect(overview).toHaveTextContent('Cancelled, cast not notified');

    rerender(
      <NeedsYouLens
        queue={queue}
        scope="all"
        onItemAction={vi.fn()}
        onOpenDate={vi.fn()}
        onBulk={vi.fn()}
        receipts={[]}
        layout="stacked"
      />
    );
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-at-risk')).toBeInTheDocument();
  });
});
