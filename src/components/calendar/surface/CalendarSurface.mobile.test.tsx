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

  it('tapping an Agenda row opens the CalendarDaySheet for that row\'s date, instead of navigating via actions.openDate', () => {
    const actions = noopActions();
    const entry = producerEntry({ id: 'pd-agenda', date: new Date(2026, 7, 12) });
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

    expect(screen.queryByTestId('calendar-day-sheet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agenda-row-pd-agenda'));

    const sheet = screen.getByTestId('calendar-day-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Cirque Noir');
    // The row tap opens the sheet — it must NOT also fire the desktop
    // "navigate straight to the date" action.
    expect(actions.openDate).not.toHaveBeenCalled();

    // The sheet's own "Open date" button still routes through actions.openDate.
    fireEvent.click(screen.getByTestId('day-sheet-open-date'));
    expect(actions.openDate).toHaveBeenCalledWith('pd-agenda');
  });

  it('producer Month renders the dense MonthGrid variant (compact cell min-height)', () => {
    const entry = producerEntry({ id: 'pd-dense', date: new Date(2026, 7, 12) });
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

    expect(screen.getByTestId('month-grid-cell-2026-08-12')).toHaveClass('min-h-[62px]');
  });

  it('artist Month renders the dense MonthGrid variant (compact cell min-height)', () => {
    const entry = artistEntry({ id: 'ad-dense', date: new Date(2026, 7, 12) });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={noopActions()}
        lens="month"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('month-grid-cell-2026-08-12')).toHaveClass('min-h-[62px]');
  });

  it('producer Week collapses to the Agenda day-list filtered to the week window, and a row tap opens the day sheet', () => {
    // TODAY = 15 Aug 2026 (Sat) -> its week is Mon 10 Aug .. Sun 16 Aug.
    const inWeek = producerEntry({ id: 'pd-in-week', date: new Date(2026, 7, 12) });
    const outOfWeek = producerEntry({ id: 'pd-out-of-week', date: new Date(2026, 7, 24) });
    const actions = noopActions();
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[inWeek, outOfWeek]}
        actions={actions}
        lens="week"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    // AgendaLens day-list renders, not the desktop WeekLens time grid.
    expect(screen.getByTestId('agenda-row-pd-in-week')).toBeInTheDocument();
    expect(screen.queryByTestId('agenda-row-pd-out-of-week')).not.toBeInTheDocument();
    expect(screen.queryByTestId('week-lens')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agenda-row-pd-in-week'));
    const sheet = screen.getByTestId('calendar-day-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Cirque Noir');
    // Row tap opens the sheet, not the desktop "navigate straight to the date".
    expect(actions.openDate).not.toHaveBeenCalled();
  });

  it('producer Season renders SeasonStripMobile, and a cell tap opens the day sheet for that date', () => {
    const entry = producerEntry({ id: 'pd-season', showId: 'show-season', date: new Date(2026, 7, 12) });
    const actions = noopActions();
    render(
      <CalendarSurface
        role="producer"
        producerEntries={[entry]}
        actions={actions}
        lens="season"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('season-strip-mobile')).toBeInTheDocument();
    expect(screen.queryByTestId('season-lens')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('season-strip-cell-show-season-2026-08-12'));

    const sheet = screen.getByTestId('calendar-day-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Cirque Noir');
    expect(actions.openDate).not.toHaveBeenCalled();
  });

  it('artist All dates renders stacked rows: the fixed table header hides at mobile', () => {
    const entry = artistEntry({ id: 'ad-all', date: new Date(2026, 7, 12) });
    render(
      <CalendarSurface
        role="artist"
        artistEntries={[entry]}
        actions={noopActions()}
        lens="all-dates"
        onLensChange={vi.fn()}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('all-dates-row-ad-all')).toBeInTheDocument();
    const header = screen.getByText('Date').parentElement;
    expect(header?.className).toMatch(/\bhidden\b/);
  });

  it('the producer Needs-you lens folds QueueRail content below the groups instead of a side rail', () => {
    const queue = {
      groups: [
        {
          key: 'at-risk' as const,
          items: [
            {
              dateId: 'pd-1',
              entry: producerEntry({ id: 'pd-1', status: 'partially_filled' }),
              group: 'at-risk' as const,
              people: [],
              earliestExpiry: null,
              openMainSlots: 3,
              leadDays: 2,
            },
          ],
        },
      ],
      totalItems: 1,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 0 },
    };

    render(
      <CalendarSurface
        role="producer"
        producerEntries={[producerEntry({ id: 'pd-1', status: 'partially_filled' })]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );

    // No desktop-style side-by-side wrapper: the rail content is the last
    // thing in the lens body, after the group, not laid out beside it.
    const group = screen.getByTestId('needs-you-group-at-risk');
    const rail = screen.getByTestId('queue-rail');
    expect(rail).toBeInTheDocument();
    expect(group.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the scope-chip row on mobile Needs-you too, filtering the groups the same way as desktop', () => {
    const queue = {
      groups: [
        {
          key: 'at-risk' as const,
          items: [
            {
              dateId: 'pd-1',
              entry: producerEntry({ id: 'pd-1', status: 'partially_filled' }),
              group: 'at-risk' as const,
              people: [],
              earliestExpiry: null,
              openMainSlots: 3,
              leadDays: 2,
            },
          ],
        },
        {
          key: 'cancelled' as const,
          items: [
            {
              dateId: 'pd-2',
              entry: producerEntry({ id: 'pd-2', status: 'cancelled' }),
              group: 'cancelled' as const,
              people: [],
              earliestExpiry: null,
              openMainSlots: 0,
              leadDays: 4,
            },
          ],
        },
      ],
      totalItems: 2,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 1 },
    };

    render(
      <CalendarSurface
        role="producer"
        producerEntries={[
          producerEntry({ id: 'pd-1', status: 'partially_filled' }),
          producerEntry({ id: 'pd-2', status: 'cancelled' }),
        ]}
        actions={noopActions()}
        lens="needs-you"
        onLensChange={vi.fn()}
        today={TODAY}
        needsYouQueue={queue}
      />
    );

    expect(screen.getByTestId('scope-chip-row')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scope-chip-cancelled'));
    expect(screen.getByTestId('needs-you-group-cancelled')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-you-group-at-risk')).not.toBeInTheDocument();
  });
});
