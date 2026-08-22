import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarSurface, type CalendarSurfaceActions } from './CalendarSurface';
import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';
import type { NeedsYouItem, NeedsYouQueue } from '@/lib/calendar/needsYou';

const TODAY = new Date(2026, 7, 15); // 15 Aug 2026 (Sat)

function producerEntry(overrides: Partial<ProducerDateEntry> = {}): ProducerDateEntry {
  return {
    id: 'pd-1',
    date: new Date(2026, 7, 10),
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: 'Berlin',
    session1: '19:00',
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 6,
    confirmedMain: 3,
    acceptedMain: 0,
    pendingMain: 1,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    ...overrides,
  };
}

function artistEntry(overrides: Partial<ArtistDateEntry> = {}): ArtistDateEntry {
  return {
    id: 'ad-1',
    date: new Date(2026, 7, 10),
    bookingId: null,
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: null,
    session1: '19:00',
    myStatus: 'unanswered',
    hireOrderId: null,
    ...overrides,
  };
}

function noopActions(): CalendarSurfaceActions {
  return {
    confirmHolds: vi.fn(),
    generateHireOrder: vi.fn(),
    openDate: vi.fn(),
    openCasting: vi.fn(),
    extendHold: vi.fn(),
    releaseHold: vi.fn(),
    notifyCast: vi.fn(),
    cancelDate: vi.fn(),
    undoCancel: vi.fn(),
    previewHireOrder: vi.fn(),
    offerArtist: vi.fn(),
    confirmAll: vi.fn(),
    generateAll: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    block: vi.fn(),
  };
}

function needsYouQueueWithAtRisk(entry: ProducerDateEntry): NeedsYouQueue {
  const item: NeedsYouItem = {
    dateId: entry.id,
    entry,
    group: 'at-risk',
    people: [],
    earliestExpiry: null,
    openMainSlots: Math.max(0, entry.mainSlots - entry.confirmedMain),
    leadDays: 3,
  };
  return {
    groups: [{ key: 'at-risk', items: [item] }],
    totalItems: 1,
    countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
  };
}

describe('CalendarSurface — producer', () => {
  it('mounts with lens="month": renders the lens SegmentedControl [Month, Agenda], the month grid, and the DayRail', () => {
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('lens-tab-month')).toBeInTheDocument();
    expect(screen.getByTestId('lens-tab-agenda')).toBeInTheDocument();
    expect(screen.queryByTestId('lens-tab-offers')).not.toBeInTheDocument();
    expect(screen.getByTestId('lens-tab-month')).toHaveAttribute('data-active', 'true');

    expect(screen.getByTestId('month-grid-cell-2026-08-10')).toBeInTheDocument();
    expect(screen.getByTestId('day-rail')).toBeInTheDocument();
  });

  it('switching to Agenda fires onLensChange("agenda")', () => {
    const onLensChange = vi.fn();
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={onLensChange}
        today={TODAY}
      />
    );

    fireEvent.click(screen.getByTestId('lens-tab-agenda'));
    expect(onLensChange).toHaveBeenCalledWith('agenda');
  });

  it('lens="agenda" renders the agenda list and no DayRail', () => {
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('agenda-lens')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-row-pd-1')).toBeInTheDocument();
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();
  });

  it('an unrecognised lens key falls back to the producer default (Needs you)', () => {
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('lens-tab-needs-you')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('needs-you-lens')).toBeInTheDocument();
  });

  it('agenda "Generate hire order" fires actions.generateHireOrder with the entry id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-9', status: 'fully_filled', confirmedMain: 6, acceptedMain: 0 });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('agenda-action-pd-9'));
    expect(actions.generateHireOrder).toHaveBeenCalledWith('pd-9');
  });

  it('agenda row click fires actions.openDate with the entry id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-7' });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('agenda-row-pd-7'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-7');
  });

  it('DayRail primary fires confirmHolds when the selected day has accepted holds', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-1', date: TODAY, acceptedMain: 2 });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    // Default selectedDay is `today`, so the rail already shows this entry.
    fireEvent.click(screen.getByTestId('day-rail-primary'));
    expect(actions.confirmHolds).toHaveBeenCalledWith('pd-1');
  });

  it('DayRail secondary ("Open date") fires actions.openDate for the selected day', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-2', date: TODAY });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('day-rail-secondary'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-2');
  });

  it('actionGates.confirmHolds reaches the DayRail primary button as disabled+titled, and its click no-ops', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-1', date: TODAY, acceptedMain: 2 });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        actionGates={{ confirmHolds: { disabled: true, title: "You don't have permission to confirm bookings" } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You don't have permission to confirm bookings");
    fireEvent.click(btn);
    expect(actions.confirmHolds).not.toHaveBeenCalled();
  });

  it('actionGates.generateHireOrder reaches the AgendaLens action button as disabled+titled, and its click no-ops', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-9', status: 'fully_filled', confirmedMain: 6, acceptedMain: 0 });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
        actionGates={{ generateHireOrder: { disabled: true, title: "You don't have permission to generate hire orders" } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-9');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You don't have permission to generate hire orders");
    fireEvent.click(btn);
    expect(actions.generateHireOrder).not.toHaveBeenCalled();
  });

  // Regression coverage for the single-resolver consolidation
  // (`resolveProducerPrimary` in DayRail.tsx): the label DayRail renders, the
  // action `handleRailPrimary` dispatches, and the gate key the button is
  // disabled under must all agree on the same kind for the same entry — they
  // can no longer silently desync since all three now read one resolution.
  it('DayRail primary label, dispatch, and gate all resolve to "confirmHolds" for the same accepted-holds entry', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-1', date: TODAY, acceptedMain: 2 });

    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    const enabledBtn = screen.getByTestId('day-rail-primary');
    expect(enabledBtn).toHaveTextContent('Book who said yes');
    expect(enabledBtn).not.toBeDisabled();
    fireEvent.click(enabledBtn);
    expect(actions.confirmHolds).toHaveBeenCalledWith('pd-1');
    expect(actions.generateHireOrder).not.toHaveBeenCalled();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        actionGates={{ confirmHolds: { disabled: true, title: 'Gated' } }}
      />
    );
    const gatedBtn = screen.getByTestId('day-rail-primary');
    expect(gatedBtn).toHaveTextContent('Book who said yes');
    expect(gatedBtn).toBeDisabled();
    expect(gatedBtn).toHaveAttribute('title', 'Gated');
  });

  it('DayRail primary label, dispatch, and gate all resolve to "generateHireOrder" for the same fully-filled entry', () => {
    const actions = noopActions();
    const entry = producerEntry({
      id: 'pd-2',
      date: TODAY,
      status: 'fully_filled',
      acceptedMain: 0,
      confirmedMain: 6,
      hireOrderId: null,
    });

    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    const enabledBtn = screen.getByTestId('day-rail-primary');
    expect(enabledBtn).toHaveTextContent('Draft the contract');
    expect(enabledBtn).not.toBeDisabled();
    fireEvent.click(enabledBtn);
    expect(actions.generateHireOrder).toHaveBeenCalledWith('pd-2');
    expect(actions.confirmHolds).not.toHaveBeenCalled();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        actionGates={{ generateHireOrder: { disabled: true, title: 'Gated' } }}
      />
    );
    const gatedBtn = screen.getByTestId('day-rail-primary');
    expect(gatedBtn).toHaveTextContent('Draft the contract');
    expect(gatedBtn).toBeDisabled();
    expect(gatedBtn).toHaveAttribute('title', 'Gated');
  });
});

describe('CalendarSurface — needs-you (producer default)', () => {
  it('mounts with lens="needs-you": Needs you is the first/active tab, NeedsYouLens renders the item, QueueRail renders alongside, and there is no PeriodNavigator', () => {
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('data-testid', 'lens-tab-needs-you');
    expect(screen.getByTestId('lens-tab-needs-you')).toHaveAttribute('data-active', 'true');

    expect(screen.getByTestId('needs-you-lens')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-item-pd-risk')).toBeInTheDocument();
    expect(screen.getByTestId('queue-rail')).toBeInTheDocument();

    expect(screen.queryByTestId('period-navigator-pill')).not.toBeInTheDocument();
  });

  it('renders gracefully with no needsYouQueue prop (empty groups, no crash)', () => {
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('needs-you-lens')).toBeInTheDocument();
    expect(screen.getByTestId('queue-rail')).toBeInTheDocument();
  });

  it('switching to Month from needs-you still works', () => {
    const onLensChange = vi.fn();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={onLensChange}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('lens-tab-month'));
    expect(onLensChange).toHaveBeenCalledWith('month');

    // Simulate the caller applying the lens change.
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="month"
        onLensChange={onLensChange}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    expect(screen.getByTestId('month-grid-cell-2026-08-10')).toBeInTheDocument();
    expect(screen.getByTestId('day-rail')).toBeInTheDocument();
  });

  it('the "Needs you" tab count reflects needsYouQueue.totalItems', () => {
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    expect(screen.getByTestId('lens-tab-needs-you')).toHaveTextContent('1');
  });

  it('maps NeedsYouAction "open-casting" (at-risk primary) to actions.openCasting with the date id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('needs-you-primary-pd-risk'));
    expect(actions.openCasting).toHaveBeenCalledWith('pd-risk');
  });

  it('maps NeedsYouAction "cancel-date" (at-risk secondary) to actions.cancelDate with the date id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('needs-you-secondary-pd-risk-cancel-date'));
    expect(actions.cancelDate).toHaveBeenCalledWith('pd-risk');
  });

  it('clicking a needs-you card fires actions.openDate with the date id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('needs-you-item-pd-risk'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-risk');
  });

  it('onBulk("expires-today", "confirm") fires actions.confirmAll with that group\'s date ids', () => {
    const actions = noopActions();
    const entry = producerEntry({
      id: 'pd-expiring',
      mainSlots: 6,
      confirmedMain: 2,
      acceptedMain: 0,
      pendingMain: 1,
    });
    const item: NeedsYouItem = {
      dateId: entry.id,
      entry,
      group: 'expires-today',
      people: [],
      earliestExpiry: new Date(2026, 7, 15, 18, 0),
      openMainSlots: 4,
      leadDays: 0,
    };
    const queue: NeedsYouQueue = {
      groups: [{ key: 'expires-today', items: [item] }],
      totalItems: 1,
      countByGroup: { 'expires-today': 1, 'at-risk': 0, 'ready-to-issue': 0, cancelled: 0 },
    };
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('needs-you-bulk-expires-today'));
    expect(actions.confirmAll).toHaveBeenCalledWith(['pd-expiring']);
  });

  it('QueueRail "Offer" fires actions.offerArtist with the shortlist date and artist ids', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
        queueShortlist={{ dateId: 'pd-risk', dateLabel: 'Sat 15 Aug', artists: [{ artistId: 'art-1', name: 'Jo Doe' }] }}
      />
    );
    fireEvent.click(screen.getByTestId('queue-offer-art-1'));
    expect(actions.offerArtist).toHaveBeenCalledWith('pd-risk', 'art-1');
  });

  it('onUndoLastReceipt fires when "Undo last" is clicked with a non-empty clearedToday', () => {
    const onUndoLastReceipt = vi.fn();
    const entry = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const queue = needsYouQueueWithAtRisk(entry);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
        clearedToday={[{ dateId: 'pd-cleared', title: 'Cirque Noir', label: 'Confirmed', kind: 'confirmedAll' }]}
        onUndoLastReceipt={onUndoLastReceipt}
      />
    );
    expect(screen.getByTestId('needs-you-receipt-0')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('needs-you-undo-last'));
    expect(onUndoLastReceipt).toHaveBeenCalled();
  });
});

function needsYouQueueWithAtRiskAndCancelled(atRisk: ProducerDateEntry, cancelled: ProducerDateEntry): NeedsYouQueue {
  const atRiskItem: NeedsYouItem = {
    dateId: atRisk.id,
    entry: atRisk,
    group: 'at-risk',
    people: [],
    earliestExpiry: null,
    openMainSlots: Math.max(0, atRisk.mainSlots - atRisk.confirmedMain),
    leadDays: 3,
  };
  const cancelledItem: NeedsYouItem = {
    dateId: cancelled.id,
    entry: cancelled,
    group: 'cancelled',
    people: [],
    earliestExpiry: null,
    openMainSlots: 0,
    leadDays: 5,
  };
  return {
    groups: [
      { key: 'at-risk', items: [atRiskItem] },
      { key: 'cancelled', items: [cancelledItem] },
    ],
    totalItems: 2,
    countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 1 },
  };
}

describe('CalendarSurface — Needs-you scope chips + toolbar key hint', () => {
  it('renders the scope-chip row only on the Needs-you lens, with an "All" chip plus one per non-empty group', () => {
    const atRisk = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const cancelled = producerEntry({ id: 'pd-cancelled', status: 'cancelled' });
    const queue = needsYouQueueWithAtRiskAndCancelled(atRisk, cancelled);
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );

    expect(screen.getByTestId('scope-chip-row')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-all')).toHaveTextContent('2');
    expect(screen.getByTestId('scope-chip-at-risk')).toHaveTextContent('1');
    expect(screen.getByTestId('scope-chip-cancelled')).toHaveTextContent('1');
    // No expires-today or ready-to-issue items in this queue, so no chip for them.
    expect(screen.queryByTestId('scope-chip-expires-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scope-chip-ready-to-issue')).not.toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    expect(screen.queryByTestId('scope-chip-row')).not.toBeInTheDocument();
  });

  it('selecting a scope chip filters the queue body to that category, without touching the QueueRail overview', () => {
    const atRisk = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const cancelled = producerEntry({ id: 'pd-cancelled', status: 'cancelled' });
    const queue = needsYouQueueWithAtRiskAndCancelled(atRisk, cancelled);
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );

    // Both groups render before any chip is selected (default "All").
    expect(screen.getByTestId('needs-you-group-at-risk')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scope-chip-cancelled'));

    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-you-group-at-risk')).not.toBeInTheDocument();
    // The chip row itself keeps showing the full, unfiltered counts.
    expect(screen.getByTestId('scope-chip-all')).toHaveTextContent('2');
    expect(screen.getByTestId('scope-chip-at-risk')).toHaveTextContent('1');
    // The side QueueRail (desktop) still reports both groups in its breakdown.
    const rail = screen.getByTestId('queue-rail');
    expect(rail).toHaveTextContent('At risk · under-cast inside 30 days');
    expect(rail).toHaveTextContent('Cancelled · needs a decision');

    fireEvent.click(screen.getByTestId('scope-chip-all'));
    expect(screen.getByTestId('needs-you-group-at-risk')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
  });

  it('resets the scope filter to "All" when the lens changes away from Needs-you and back', () => {
    const atRisk = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const cancelled = producerEntry({ id: 'pd-cancelled', status: 'cancelled' });
    const queue = needsYouQueueWithAtRiskAndCancelled(atRisk, cancelled);
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('scope-chip-cancelled'));
    expect(screen.queryByTestId('needs-you-group-at-risk')).not.toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    expect(screen.getByTestId('needs-you-group-at-risk')).toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
  });

  it('snaps the selected scope back to "All" when its group empties out on a refetch, instead of stranding an empty body', () => {
    const atRisk = producerEntry({ id: 'pd-risk', mainSlots: 6, confirmedMain: 2 });
    const cancelled = producerEntry({ id: 'pd-cancelled', status: 'cancelled' });
    const queue = needsYouQueueWithAtRiskAndCancelled(atRisk, cancelled);
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );
    fireEvent.click(screen.getByTestId('scope-chip-cancelled'));
    expect(screen.queryByTestId('needs-you-group-at-risk')).not.toBeInTheDocument();
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();

    // A refetch (same lens, same "cancelled" scope selected) clears the
    // cancelled group out from under the user — e.g. it was reopened
    // elsewhere. `ScopeChips` would drop the now-zero "Cancelled" chip
    // entirely, so without the reset the body would show nothing with no
    // active chip to explain why.
    const refetchedQueue: NeedsYouQueue = {
      groups: [{ key: 'at-risk', items: queue.groups[0].items }],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[atRisk, cancelled]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={refetchedQueue}
      />
    );

    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('needs-you-group-at-risk')).toBeInTheDocument();
  });

  it('renders a right-aligned key-hint on the toolbar row for month/week/season/agenda/needs-you, and none for Offers/All dates', () => {
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('calendar-toolbar-key-hint')).toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('calendar-toolbar-key-hint')).toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry()]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('calendar-toolbar-key-hint')).not.toBeInTheDocument();
  });

  it('the Month lens key hint promises Space-peek only for the producer, never for the artist', () => {
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('calendar-toolbar-key-hint')).toHaveTextContent(/Space/);

    rerender(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    const artistHint = screen.getByTestId('calendar-toolbar-key-hint');
    expect(artistHint).toBeInTheDocument();
    expect(artistHint).not.toHaveTextContent(/Space/);
  });
});

describe('CalendarSurface — artist', () => {
  it('defaults to the Offers lens and renders [Offers, Month, All dates] tabs', () => {
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry({ myStatus: 'suggested', bookingId: 'bk-1' })]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('lens-tab-offers')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('lens-tab-month')).toBeInTheDocument();
    expect(screen.getByTestId('lens-tab-all-dates')).toBeInTheDocument();
    expect(screen.getByTestId('offers-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();
  });

  it('an unrecognised lens key falls back to Offers for the artist role', () => {
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[]}
        actions={noopActions()}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('lens-tab-offers')).toHaveAttribute('data-active', 'true');
  });

  it('Offers lens Accept fires actions.accept with the booking id', () => {
    const actions = noopActions();
    const entry = artistEntry({ id: 'ad-1', myStatus: 'suggested', bookingId: 'bk-42' });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={actions}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('offer-accept-ad-1'));
    expect(actions.accept).toHaveBeenCalledWith('bk-42');
  });

  it('lens="month" renders the month grid and the DayRail (artist variant)', () => {
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry({ date: new Date(2026, 7, 10) })]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('month-grid-cell-2026-08-10')).toBeInTheDocument();
    expect(screen.getByTestId('day-rail')).toBeInTheDocument();
  });

  it('DayRail primary fires actions.block for an unanswered selected day', () => {
    const actions = noopActions();
    const entry = artistEntry({ id: 'ad-3', date: TODAY, myStatus: 'unanswered' });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('day-rail-primary'));
    expect(actions.block).toHaveBeenCalledWith('ad-3', TODAY);
  });

  it('lens="all-dates" renders the full table and Block-date fires actions.block', () => {
    const actions = noopActions();
    const entry = artistEntry({ id: 'ad-5', date: new Date(2026, 7, 20), myStatus: 'unanswered' });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={actions}
        lens="all-dates"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('all-dates-lens')).toBeInTheDocument();
    expect(screen.getByTestId('all-dates-row-ad-5')).toBeInTheDocument();
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('all-dates-block-ad-5'));
    expect(actions.block).toHaveBeenCalledWith('ad-5', entry.date);
  });

  it('"Later this month · not offered yet" excludes an unanswered date in the next month', () => {
    const inMonth = artistEntry({ id: 'ad-in-month', date: new Date(2026, 7, 25), myStatus: 'unanswered' });
    const nextMonth = artistEntry({ id: 'ad-next-month', date: new Date(2026, 8, 5), myStatus: 'unanswered' });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[inMonth, nextMonth]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('not-offered-row-ad-in-month')).toBeInTheDocument();
    expect(screen.queryByTestId('not-offered-row-ad-next-month')).not.toBeInTheDocument();
  });
});

describe('CalendarSurface — period navigator visibility', () => {
  it('shows the PeriodNavigator for the Month and Agenda lenses', () => {
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('period-navigator-pill')).toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.getByTestId('period-navigator-pill')).toBeInTheDocument();
  });

  it('hides the PeriodNavigator for the Offers and All-dates lenses', () => {
    const { rerender } = render(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry()]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('period-navigator-pill')).not.toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry()]}
        actions={noopActions()}
        lens="all-dates"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('period-navigator-pill')).not.toBeInTheDocument();
  });
});

describe('CalendarSurface — Week + Season lenses', () => {
  it('producer lens order is Needs you, Month, Week, Season, Agenda', () => {
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    const tabs = screen.getAllByRole('tab');
    const keys = tabs.map((t) => t.getAttribute('data-testid'));
    expect(keys).toEqual([
      'lens-tab-needs-you',
      'lens-tab-month',
      'lens-tab-week',
      'lens-tab-season',
      'lens-tab-agenda',
    ]);
  });

  it('lens="week": WeekLens time grid renders, and the PeriodNavigator shows the week label and advances by a week on Next', () => {
    const entry = producerEntry({ date: TODAY, session1: '19:00' });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="week"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('lens-tab-week')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('week-lens')).toBeInTheDocument();
    expect(screen.getByTestId('week-column-2026-08-15')).toBeInTheDocument();
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();

    expect(screen.getByTestId('period-navigator-pill')).toHaveTextContent('10 Aug - 16 Aug 2026');

    fireEvent.click(screen.getByTestId('period-navigator-next'));
    expect(screen.getByTestId('period-navigator-pill')).toHaveTextContent('17 Aug - 23 Aug 2026');
  });

  it('lens="season": SeasonLens renders and the PeriodNavigator shows the season label', () => {
    const entry = producerEntry({ date: TODAY });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="season"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('lens-tab-season')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('season-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('period-navigator-pill')).toHaveTextContent('Aug - Oct 2026');
  });

  it('week/season lens clicks fire actions.openDate with the entry id', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-week', date: TODAY, session1: '19:00' });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="week"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    fireEvent.click(screen.getByTestId('week-block-pd-week-1'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-week');
  });
});

describe('CalendarSurface — range selection + SelectionBar (producer, month lens)', () => {
  it('a drag across the month grid selects the range, the bar counts only keys that map to real entries, Confirm dispatches onBulkConfirm with those ids, and Clear hides the bar', () => {
    const onBulkConfirm = vi.fn();
    const onBulkGenerate = vi.fn();
    // Range Aug 10-13 (4 days): entries at 10, 11, 13 — 12 has no entry and
    // must be excluded from the count and from the dispatched ids.
    const entries = [
      producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-11', date: new Date(2026, 7, 11) }),
      producerEntry({ id: 'pd-13', date: new Date(2026, 7, 13) }),
    ];
    render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        onBulkConfirm={onBulkConfirm}
        onBulkGenerate={onBulkGenerate}
      />
    );

    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();

    const cellStart = screen.getByTestId('month-grid-cell-2026-08-10');
    const cellEnd = screen.getByTestId('month-grid-cell-2026-08-13');

    fireEvent.mouseDown(cellStart);
    fireEvent.mouseEnter(cellEnd);
    fireEvent.mouseUp(cellEnd);

    // The whole 4-day span is highlighted in-range, including the entryless day.
    expect(screen.getByTestId('month-grid-cell-2026-08-10')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-11')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-12')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-13')).toHaveAttribute('data-in-range', 'true');

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('3 selected');

    fireEvent.click(screen.getByTestId('selection-bar-action-confirm'));
    expect(onBulkConfirm).toHaveBeenCalledWith(['pd-10', 'pd-11', 'pd-13']);
    expect(onBulkGenerate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('selection-bar-clear'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it("Generate fires onBulkGenerate with the selected date ids", () => {
    const onBulkGenerate = vi.fn();
    const entries = [
      producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-11', date: new Date(2026, 7, 11) }),
    ];
    render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        onBulkGenerate={onBulkGenerate}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-10'));
    fireEvent.mouseEnter(screen.getByTestId('month-grid-cell-2026-08-11'));
    fireEvent.mouseUp(screen.getByTestId('month-grid-cell-2026-08-11'));

    fireEvent.click(screen.getByTestId('selection-bar-action-generate'));
    expect(onBulkGenerate).toHaveBeenCalledWith(['pd-10', 'pd-11']);
  });

  it('bulkGates disable the Confirm/Generate buttons with a title, and the range clears when the lens changes', () => {
    const onLensChange = vi.fn();
    const entries = [producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) })];
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={onLensChange}
        today={TODAY}
        bulkGates={{
          confirm: { disabled: true, title: 'No permission to confirm' },
          generate: { disabled: true, title: 'No permission to generate' },
        }}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-10'));
    fireEvent.mouseEnter(screen.getByTestId('month-grid-cell-2026-08-10'));
    // A single-cell "drag" needs a genuine move to arm — extend onto the
    // same cell via shift-click instead, which unconditionally extends.
    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-10'), { shiftKey: true });

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('1 selected');
    const confirmBtn = screen.getByTestId('selection-bar-action-confirm');
    const generateBtn = screen.getByTestId('selection-bar-action-generate');
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveAttribute('title', 'No permission to confirm');
    expect(generateBtn).toBeDisabled();
    expect(generateBtn).toHaveAttribute('title', 'No permission to generate');

    // Switching lens away and back must drop the prior range selection.
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="agenda"
        onLensChange={onLensChange}
        today={TODAY}
      />
    );
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={onLensChange}
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('shift-click-to-range: plain click date A then shift-click date C selects the full A..C span; a fresh plain click clears the range', () => {
    // Regression for the whole-branch review finding: shift-click without a
    // preceding drag must seed the anchor from the last plain click
    // (`selectedDay`), not leave `range` null (which would collapse the
    // shift-click into a single-day selection).
    const entries = [
      producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-11', date: new Date(2026, 7, 11) }),
      producerEntry({ id: 'pd-13', date: new Date(2026, 7, 13) }),
    ];
    render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    // Plain click date A (10 Aug) — no drag, so no range should appear yet.
    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-10'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();

    // Shift-click date C (13 Aug) — MonthGrid's shift-click path only calls
    // onRangeExtend (no onSelectDay), so this must extend from the plain
    // click's anchor, not start a fresh single-day range.
    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-13'), { shiftKey: true });

    expect(screen.getByTestId('month-grid-cell-2026-08-10')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-11')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-12')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('month-grid-cell-2026-08-13')).toHaveAttribute('data-in-range', 'true');
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('3 selected');

    // A fresh plain click resets the anchor — the stale range must disappear.
    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-11'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('a range over a day with two producer entries dispatches both ids and the count includes both', () => {
    // Regression: producerEntryIdByKey used to be last-write-wins per
    // day-key, so a day with two co-shows only contributed one id to the
    // bulk dispatch and the SelectionBar count.
    const onBulkConfirm = vi.fn();
    const entries = [
      producerEntry({ id: 'pd-10a', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-10b', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-11', date: new Date(2026, 7, 11) }),
    ];
    render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        onBulkConfirm={onBulkConfirm}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-10'));
    fireEvent.mouseEnter(screen.getByTestId('month-grid-cell-2026-08-11'));
    fireEvent.mouseUp(screen.getByTestId('month-grid-cell-2026-08-11'));

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('3 selected');

    fireEvent.click(screen.getByTestId('selection-bar-action-confirm'));
    expect(onBulkConfirm).toHaveBeenCalledWith(['pd-10a', 'pd-10b', 'pd-11']);
  });

  it('does not render the SelectionBar for the artist role', () => {
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry({ date: new Date(2026, 7, 10) })]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('month-grid-cell-2026-08-10'));
    fireEvent.mouseEnter(screen.getByTestId('month-grid-cell-2026-08-11'));
    fireEvent.mouseUp(screen.getByTestId('month-grid-cell-2026-08-11'));

    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

describe('CalendarSurface — range selection + SelectionBar (producer, season lens)', () => {
  it('a day-column drag on the Season lens selects the range, shows the SelectionBar with the count of dates in the span, and Confirm dispatches those ids', () => {
    const onBulkConfirm = vi.fn();
    // Span Aug 10-13 (4 days): entries at 10, 11, 13 — 12 has no entry and
    // must be excluded from the count and from the dispatched ids, same as
    // the Month-lens contract (selection is by shared day-key).
    const entries = [
      producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) }),
      producerEntry({ id: 'pd-11', date: new Date(2026, 7, 11) }),
      producerEntry({ id: 'pd-13', date: new Date(2026, 7, 13) }),
    ];
    render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="season"
        onLensChange={vi.fn()}
        today={TODAY}
        onBulkConfirm={onBulkConfirm}
      />
    );

    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();

    const cellStart = screen.getByTestId('season-cell-pd-10-2026-08-10');
    const cellEnd = screen.getByTestId('season-cell-pd-13-2026-08-13');

    fireEvent.mouseDown(cellStart);
    fireEvent.mouseEnter(cellEnd);
    fireEvent.mouseUp(cellEnd);

    // The whole 4-day span is highlighted in-range, including the entryless day.
    expect(screen.getByTestId('season-day-2026-08-10')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('season-day-2026-08-11')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('season-day-2026-08-12')).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByTestId('season-day-2026-08-13')).toHaveAttribute('data-in-range', 'true');

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('3 selected');

    fireEvent.click(screen.getByTestId('selection-bar-action-confirm'));
    expect(onBulkConfirm).toHaveBeenCalledWith(['pd-10', 'pd-11', 'pd-13']);

    fireEvent.click(screen.getByTestId('selection-bar-clear'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('the range clears when switching from Season to another lens', () => {
    const entries = [producerEntry({ id: 'pd-10', date: new Date(2026, 7, 10) })];
    const { rerender } = render(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="season"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('season-cell-pd-10-2026-08-10'));
    fireEvent.mouseEnter(screen.getByTestId('season-day-2026-08-11'));
    fireEvent.mouseUp(screen.getByTestId('season-day-2026-08-11'));
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();

    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    rerender(
      <CalendarSurface
        role="producer"
        producerEntries={entries}
        actions={noopActions()}
        lens="season"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

describe('CalendarSurface — agenda is period-windowed', () => {
  it('clicking Prev swaps the agenda body to the previous month', () => {
    const augEntry = producerEntry({ id: 'pd-aug', date: new Date(2026, 7, 10) });
    const julEntry = producerEntry({ id: 'pd-jul', date: new Date(2026, 6, 10) });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[augEntry, julEntry]}
        actions={noopActions()}
        lens="agenda"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );
    // Anchor starts at `today` (Aug 2026): only the August entry is shown.
    expect(screen.getByTestId('agenda-row-pd-aug')).toBeInTheDocument();
    expect(screen.queryByTestId('agenda-row-pd-jul')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('period-navigator-prev'));

    expect(screen.getByTestId('agenda-row-pd-jul')).toBeInTheDocument();
    expect(screen.queryByTestId('agenda-row-pd-aug')).not.toBeInTheDocument();
  });
});

describe('CalendarSurface — Space-peek popover (producer, month lens)', () => {
  it('Space on a producer date cell opens a RowPeek showing the headline/meter; Confirm and Open date dispatch with the entry id', () => {
    const actions = noopActions();
    const entry = producerEntry({
      id: 'pd-peek',
      date: new Date(2026, 7, 10),
      mainSlots: 4,
      confirmedMain: 2,
      acceptedMain: 1,
      understudySlots: 0,
      confirmedUs: 0,
    });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    const cell = screen.getByTestId('month-grid-cell-2026-08-10');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ' });

    const popover = screen.getByTestId('date-peek-popover');
    // Headline reflects computeDatePeek's math: 1 accepted waiting, 1 main slot open.
    expect(within(popover).getByText('1 said yes, waiting on you · 1 main place open')).toBeInTheDocument();

    fireEvent.click(within(popover).getByRole('button', { name: 'Book 1' }));
    expect(actions.confirmHolds).toHaveBeenCalledWith('pd-peek');

    fireEvent.click(within(popover).getByRole('button', { name: 'Open date' }));
    expect(actions.openDate).toHaveBeenCalledWith('pd-peek');
  });

  it('actionGates.confirmHolds disabled hides the peek Confirm button', () => {
    const actions = noopActions();
    const entry = producerEntry({
      id: 'pd-peek-2',
      date: new Date(2026, 7, 11),
      mainSlots: 4,
      confirmedMain: 2,
      acceptedMain: 1,
    });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
        actionGates={{ confirmHolds: { disabled: true, title: 'Gated' } }}
      />
    );

    const cell = screen.getByTestId('month-grid-cell-2026-08-11');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ' });

    const popover = screen.getByTestId('date-peek-popover');
    expect(within(popover).getByRole('button', { name: 'Open date' })).toBeInTheDocument();
    expect(within(popover).queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it('does not open a peek for the artist role (Space falls through to plain selection)', () => {
    const actions = noopActions();
    const entry = artistEntry({ id: 'ad-peek', date: new Date(2026, 7, 10) });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={actions}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    const cell = screen.getByTestId('month-grid-cell-2026-08-10');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ' });

    expect(screen.queryByRole('button', { name: 'Open date' })).not.toBeInTheDocument();
  });
});
