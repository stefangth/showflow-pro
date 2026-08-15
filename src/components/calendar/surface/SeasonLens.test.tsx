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

  describe('range selection across day columns', () => {
    it('dragging across 3 day columns fires onRangeStart/onRangeExtend/onRangeCommit in order and does not fire onOpenDate', () => {
      const onOpenDate = vi.fn();
      const onRangeStart = vi.fn();
      const onRangeExtend = vi.fn();
      const onRangeCommit = vi.fn();
      render(
        <SeasonLens
          entries={[entryA, entryB]}
          anchor={ANCHOR}
          readyIds={new Set()}
          onOpenDate={onOpenDate}
          onRangeStart={onRangeStart}
          onRangeExtend={onRangeExtend}
          onRangeCommit={onRangeCommit}
        />
      );

      // Drag from 5 Aug (entryA's cell, show-a) through 6 Aug (entryB's
      // cell, show-b) to the 7 Aug header — 3 distinct day columns, mixing
      // header + cell mousedown/mouseenter surfaces.
      const startCell = screen.getByTestId(`season-cell-show-a-${toDateKey(new Date(2026, 7, 5))}`);
      const midCell = screen.getByTestId(`season-cell-show-b-${toDateKey(new Date(2026, 7, 6))}`);
      const endHeader = screen.getByTestId(`season-day-${toDateKey(new Date(2026, 7, 7))}`);

      fireEvent.mouseDown(startCell);
      expect(onRangeStart).not.toHaveBeenCalled();

      fireEvent.mouseEnter(midCell);
      expect(onRangeStart).toHaveBeenCalledTimes(1);
      expect(onRangeStart).toHaveBeenCalledWith(toDateKey(new Date(2026, 7, 5)));
      expect(onRangeExtend).toHaveBeenCalledTimes(1);
      expect(onRangeExtend).toHaveBeenCalledWith(toDateKey(new Date(2026, 7, 6)));

      fireEvent.mouseEnter(endHeader);
      expect(onRangeExtend).toHaveBeenCalledTimes(2);
      expect(onRangeExtend).toHaveBeenLastCalledWith(toDateKey(new Date(2026, 7, 7)));

      expect(onRangeCommit).not.toHaveBeenCalled();
      fireEvent.mouseUp(endHeader);
      expect(onRangeCommit).toHaveBeenCalledTimes(1);

      expect(onOpenDate).not.toHaveBeenCalled();
    });

    it('tints inRange day columns on the header and every program-row cell', () => {
      const rangeKeys = [
        toDateKey(new Date(2026, 7, 5)),
        toDateKey(new Date(2026, 7, 6)),
        toDateKey(new Date(2026, 7, 7)),
      ];
      render(
        <SeasonLens entries={[entryA, entryB]} anchor={ANCHOR} readyIds={new Set()} onOpenDate={vi.fn()} rangeKeys={rangeKeys} />
      );

      for (const key of rangeKeys) {
        expect(screen.getByTestId(`season-day-${key}`)).toHaveAttribute('data-in-range', 'true');
      }
      expect(screen.getByTestId(`season-cell-show-a-${toDateKey(new Date(2026, 7, 5))}`)).toHaveAttribute(
        'data-in-range',
        'true'
      );
      expect(screen.getByTestId(`season-cell-show-b-${toDateKey(new Date(2026, 7, 6))}`)).toHaveAttribute(
        'data-in-range',
        'true'
      );
      // show-a has no date on 6 Aug -> renders the empty-cell div, which must
      // still tint since the whole column is in range.
      expect(screen.getByTestId(`season-cell-show-a-${toDateKey(new Date(2026, 7, 6))}`)).toHaveAttribute(
        'data-in-range',
        'true'
      );

      // A day outside the range stays untinted.
      expect(screen.getByTestId(`season-day-${toDateKey(new Date(2026, 7, 8))}`)).toHaveAttribute(
        'data-in-range',
        'false'
      );
    });

    it('a plain click on a populated cell still fires onOpenDate, not a 1-column range', () => {
      const onOpenDate = vi.fn();
      const onRangeStart = vi.fn();
      const onRangeExtend = vi.fn();
      const onRangeCommit = vi.fn();
      render(
        <SeasonLens
          entries={[entryA, entryB]}
          anchor={ANCHOR}
          readyIds={new Set()}
          onOpenDate={onOpenDate}
          onRangeStart={onRangeStart}
          onRangeExtend={onRangeExtend}
          onRangeCommit={onRangeCommit}
        />
      );

      const cell = screen.getByTestId(`season-cell-show-a-${toDateKey(entryA.date)}`);
      fireEvent.mouseDown(cell);
      fireEvent.click(cell);
      fireEvent.mouseUp(cell);

      expect(onOpenDate).toHaveBeenCalledTimes(1);
      expect(onOpenDate).toHaveBeenCalledWith('sd-a');
      expect(onRangeStart).not.toHaveBeenCalled();
      expect(onRangeExtend).not.toHaveBeenCalled();
      expect(onRangeCommit).not.toHaveBeenCalled();
    });
  });
});
