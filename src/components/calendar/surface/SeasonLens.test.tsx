import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { differenceInCalendarDays } from 'date-fns';
import { SeasonLens } from './SeasonLens';
import { periodWindow } from '@/lib/calendar/period';
import { toDateKey } from '@/lib/dates';
import type { ProducerDateEntry } from '@/lib/calendar/types';

// Deterministic anchor: Fri 14 Aug 2026 -> season window is Aug 1 .. Oct 31 2026
// (3 calendar months, per src/lib/calendar/period.ts).
const ANCHOR = new Date(2026, 7, 14);

function makeEntry(overrides: Partial<ProducerDateEntry> & Pick<ProducerDateEntry, 'id' | 'date' | 'showId'>): ProducerDateEntry {
  return {
    program: 'Aida',
    subProgram: null,
    venue: 'Opera House',
    city: 'Berlin',
    session1: null,
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 6,
    confirmedMain: 3,
    acceptedMain: 0,
    pendingMain: 0,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    ...overrides,
  };
}

describe('SeasonLens', () => {
  const entryA = makeEntry({
    id: 'sd-a',
    showId: 'show-a',
    date: new Date(2026, 7, 5), // Wed 5 Aug
    program: 'Aida',
    mainSlots: 6,
    confirmedMain: 3,
  });
  const entryB = makeEntry({
    id: 'sd-b',
    showId: 'show-b',
    date: new Date(2026, 7, 6), // Thu 6 Aug
    program: 'Carmen',
    mainSlots: 4,
    confirmedMain: 4,
    status: 'fully_filled',
  });

  it('renders one row per show, the correct number of day columns, and the load-bar row', () => {
    render(
      <SeasonLens entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />
    );

    expect(screen.getByTestId('season-row-show-a')).toBeInTheDocument();
    expect(screen.getByTestId('season-row-show-b')).toBeInTheDocument();

    const { start, end } = periodWindow(ANCHOR, 'season');
    const expectedDayCount = differenceInCalendarDays(end, start) + 1;
    expect(screen.getAllByTestId(/^season-day-/)).toHaveLength(expectedDayCount);

    expect(screen.getByTestId(`season-loadbar-${toDateKey(entryA.date)}`)).toBeInTheDocument();
    expect(screen.getByTestId(`season-loadbar-${toDateKey(entryB.date)}`)).toBeInTheDocument();
  });

  it('fires onOpenDate with the dateId when a populated cell is clicked', () => {
    const onOpenDate = vi.fn();
    render(
      <SeasonLens entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={onOpenDate} />
    );

    const cell = screen.getByTestId(`season-cell-show-a-${toDateKey(entryA.date)}`);
    fireEvent.click(cell);

    expect(onOpenDate).toHaveBeenCalledTimes(1);
    expect(onOpenDate).toHaveBeenCalledWith('sd-a');
  });

  it('does not fire onOpenDate when an empty (no-date) cell is clicked', () => {
    const onOpenDate = vi.fn();
    render(
      <SeasonLens entries={[entryA]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={onOpenDate} />
    );

    // show-a has no date on 6 Aug -> that cell is empty.
    const emptyCell = screen.getByTestId(`season-cell-show-a-${toDateKey(new Date(2026, 7, 6))}`);
    fireEvent.click(emptyCell);

    expect(onOpenDate).not.toHaveBeenCalled();
  });

  it('renders the SeasonKpis summary below the grid', () => {
    render(
      <SeasonLens entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set(['sd-b'])} onOpenDate={vi.fn()} />
    );

    expect(screen.getByTestId('season-kpis')).toBeInTheDocument();
    // unfilled = (6-3) + (4-4) = 3; readyForHireOrder = 1 (sd-b).
    expect(screen.getByTestId('season-kpi-unfilledMainSlots')).toHaveTextContent('3');
    expect(screen.getByTestId('season-kpi-readyForHireOrder')).toHaveTextContent('1');
  });
});
