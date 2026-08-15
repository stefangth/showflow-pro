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
        receipts={[{ dateId: 'd-cleared', title: 'Cirque Noir', label: 'Confirmed' }]}
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

    // Bulk button for expires-today fires onBulk('expires-today', 'confirm').
    fireEvent.click(screen.getByTestId('needs-you-bulk-expires-today'));
    expect(onBulk).toHaveBeenCalledTimes(1);
    expect(onBulk).toHaveBeenCalledWith('expires-today', 'confirm');

    // The ready item's primary action fires onItemAction(item, 'generate').
    fireEvent.click(screen.getByTestId('needs-you-primary-d-ready'));
    expect(onItemAction).toHaveBeenCalledTimes(1);
    expect(onItemAction).toHaveBeenCalledWith(readyItem, 'generate');

    // Receipts footer: a receipt row + "Undo last" fires onUndoLast.
    expect(screen.getByTestId('needs-you-receipts')).toBeInTheDocument();
    expect(screen.getByText('Cirque Noir')).toBeInTheDocument();
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
});
