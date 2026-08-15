import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('mounts with lens="month": renders LensTabs [Month, Agenda], the month grid, and the DayRail', () => {
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
    expect(enabledBtn).toHaveTextContent('Confirm holds');
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
    expect(gatedBtn).toHaveTextContent('Confirm holds');
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
    expect(enabledBtn).toHaveTextContent('Generate hire order');
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
    expect(gatedBtn).toHaveTextContent('Generate hire order');
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
        clearedToday={[{ dateId: 'pd-cleared', title: 'Cirque Noir', label: 'Confirmed' }]}
        onUndoLastReceipt={onUndoLastReceipt}
      />
    );
    expect(screen.getByTestId('needs-you-receipt-0')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('needs-you-undo-last'));
    expect(onUndoLastReceipt).toHaveBeenCalled();
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
