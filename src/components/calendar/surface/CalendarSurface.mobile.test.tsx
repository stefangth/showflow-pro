import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarSurface, type CalendarSurfaceActions } from './CalendarSurface';
import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}));

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

describe('CalendarSurface — mobile shell (useIsMobile true)', () => {
  it('renders the mobile tree: scrollable LensTabs, no fixed 280px DayRail', () => {
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

    const tabs = screen.getByRole('tablist');
    expect(tabs.className).toMatch(/overflow-x-auto/);
    expect(screen.queryByTestId('day-rail')).not.toBeInTheDocument();
  });

  it('tapping a Month cell opens the CalendarDaySheet showing that day', () => {
    const entry = producerEntry({ id: 'pd-tap', date: new Date(2026, 7, 12) });
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.queryByTestId('calendar-day-sheet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-12'));

    const sheet = screen.getByTestId('calendar-day-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Cirque Noir');
  });

  it('CalendarDaySheet primary fires actions.confirmHolds via the same resolution as the desktop rail', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-confirm', date: new Date(2026, 7, 12), acceptedMain: 2 });
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

    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-12'));
    fireEvent.click(screen.getByTestId('day-rail-primary'));
    expect(actions.confirmHolds).toHaveBeenCalledWith('pd-confirm');
  });

  it('CalendarDaySheet "Open date" fires actions.openDate for the tapped day', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-open', date: new Date(2026, 7, 12) });
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

    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-12'));
    fireEvent.click(screen.getByTestId('day-sheet-open-date'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-open');
  });

  it('SurfaceFab renders for producer on the needs-you (landing) lens and fires onNewDate', () => {
    const onNewDate = vi.fn();
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry()]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        onNewDate={onNewDate}
      />
    );

    const fab = screen.getByTestId('surface-fab');
    expect(fab).toBeInTheDocument();
    fireEvent.click(fab);
    expect(onNewDate).toHaveBeenCalledTimes(1);
  });

  it('SurfaceFab is absent for the artist role', () => {
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[artistEntry()]}
        actions={noopActions()}
        lens="offers"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.queryByTestId('surface-fab')).not.toBeInTheDocument();
  });

  it('SurfaceFab is absent on a non-landing producer lens (Month)', () => {
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

    expect(screen.queryByTestId('surface-fab')).not.toBeInTheDocument();
  });
});
