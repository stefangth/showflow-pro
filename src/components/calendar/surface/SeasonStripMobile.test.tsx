import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { differenceInCalendarDays } from 'date-fns';
import { SeasonStripMobile } from './SeasonStripMobile';
import { periodWindow } from '@/lib/calendar/period';
import { toDateKey } from '@/lib/dates';
import type { ProducerDateEntry } from '@/lib/calendar/types';

// Deterministic anchor: Fri 14 Aug 2026 -> season window is Aug 1 .. Oct 31 2026
// (3 calendar months, per src/lib/calendar/period.ts) — matches SeasonLens.test.tsx.
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

describe('SeasonStripMobile', () => {
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

  it('renders one frozen label row per show, the correct number of day columns, and the load-bar row', () => {
    render(<SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />);

    expect(screen.getByTestId('season-strip-row-show-a')).toBeInTheDocument();
    expect(screen.getByTestId('season-strip-row-show-b')).toBeInTheDocument();
    expect(screen.getByTestId('season-strip-label-show-a')).toHaveTextContent('Aida');
    expect(screen.getByTestId('season-strip-label-show-b')).toHaveTextContent('Carmen');

    const { start, end } = periodWindow(ANCHOR, 'season');
    const expectedDayCount = differenceInCalendarDays(end, start) + 1;
    expect(screen.getAllByTestId(/^season-strip-day-/)).toHaveLength(expectedDayCount);

    expect(screen.getByTestId('season-strip-loadbar-row')).toBeInTheDocument();
    expect(screen.getByTestId('season-strip-label-open')).toHaveTextContent('Open');
    expect(screen.getByTestId(`season-strip-loadbar-${toDateKey(entryA.date)}`)).toBeInTheDocument();
    expect(screen.getByTestId(`season-strip-loadbar-${toDateKey(entryB.date)}`)).toBeInTheDocument();
  });

  it('shows a "N dates · -N" meta line per row derived from the populated cells', () => {
    render(<SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />);

    // show-a: 1 date, unfilled = 6 - 3 = 3.
    expect(screen.getByTestId('season-strip-label-show-a')).toHaveTextContent('1 date · -3');
    // show-b: 1 date, unfilled = 4 - 4 = 0.
    expect(screen.getByTestId('season-strip-label-show-b')).toHaveTextContent('1 date · -0');
  });

  it('colours each program bar by status tone and shows an x for a cancelled date', () => {
    const entryCancelled = makeEntry({
      id: 'sd-c',
      showId: 'show-c',
      date: new Date(2026, 7, 7), // Fri 7 Aug
      status: 'cancelled',
      mainSlots: 4,
      confirmedMain: 0,
    });
    render(
      <SeasonStripMobile entries={[entryA, entryB, entryCancelled]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />
    );

    expect(screen.getByTestId(`season-strip-cell-show-b-${toDateKey(entryB.date)}`).querySelector('span')).toHaveClass(
      'bg-[var(--green-500)]'
    );
    expect(screen.getByTestId(`season-strip-cell-show-a-${toDateKey(entryA.date)}`).querySelector('span')).toHaveClass(
      'bg-[var(--amber-500)]'
    );

    const cancelled = screen.getByTestId(`season-strip-cell-show-c-${toDateKey(entryCancelled.date)}`);
    expect(cancelled).toHaveAttribute('data-status', 'cancelled');
    expect(cancelled).toHaveTextContent('×');
  });

  it('fires onOpenDate with the dateId when a populated cell is tapped', () => {
    const onOpenDate = vi.fn();
    render(<SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={onOpenDate} />);

    const cell = screen.getByTestId(`season-strip-cell-show-a-${toDateKey(entryA.date)}`);
    fireEvent.click(cell);

    expect(onOpenDate).toHaveBeenCalledTimes(1);
    expect(onOpenDate).toHaveBeenCalledWith('sd-a');
  });

  it('does not fire onOpenDate when an empty (no-date) cell is tapped', () => {
    const onOpenDate = vi.fn();
    render(<SeasonStripMobile entries={[entryA]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={onOpenDate} />);

    // show-a has no date on 6 Aug -> that cell is empty.
    const emptyCell = screen.getByTestId(`season-strip-cell-show-a-${toDateKey(new Date(2026, 7, 6))}`);
    fireEvent.click(emptyCell);

    expect(onOpenDate).not.toHaveBeenCalled();
  });

  it('contains the horizontal scroll to the strip, with a sticky frozen label column', () => {
    render(<SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />);

    expect(screen.getByTestId('season-strip-scroll')).toHaveClass('overflow-x-auto');

    const label = screen.getByTestId('season-strip-label-show-a');
    expect(label).toHaveClass('sticky');
    expect(label).toHaveClass('left-0');

    const openLabel = screen.getByTestId('season-strip-label-open');
    expect(openLabel).toHaveClass('sticky');
    expect(openLabel).toHaveClass('left-0');
  });

  it('marks a cell as ready when its dateId is in readyIds', () => {
    render(
      <SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set(['sd-b'])} onOpenDate={vi.fn()} />
    );

    expect(screen.getByTestId(`season-strip-cell-show-b-${toDateKey(entryB.date)}`)).toHaveAttribute(
      'data-ready',
      'true'
    );
    expect(screen.getByTestId(`season-strip-cell-show-a-${toDateKey(entryA.date)}`)).toHaveAttribute(
      'data-ready',
      'false'
    );
  });

  describe('today tinting', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('tints the day header column that matches today', () => {
      vi.setSystemTime(entryA.date); // 5 Aug 2026, inside the season window
      render(<SeasonStripMobile entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} />);

      expect(screen.getByTestId(`season-strip-day-${toDateKey(entryA.date)}`)).toHaveAttribute('data-today', 'true');
      expect(screen.getByTestId(`season-strip-day-${toDateKey(entryB.date)}`)).toHaveAttribute('data-today', 'false');
    });
  });
});
