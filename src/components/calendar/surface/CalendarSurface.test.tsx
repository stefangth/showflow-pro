import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarSurface, type CalendarSurfaceActions } from './CalendarSurface';
import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';

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
    accept: vi.fn(),
    decline: vi.fn(),
    block: vi.fn(),
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

  it('an unrecognised lens key falls back to the Month default', () => {
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
    expect(screen.getByTestId('lens-tab-month')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('day-rail')).toBeInTheDocument();
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
});
