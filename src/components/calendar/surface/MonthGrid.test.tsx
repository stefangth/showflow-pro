import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthGrid } from './MonthGrid';
import type { MonthGridCell } from '@/lib/calendar/types';

function buildCells(): MonthGridCell[] {
  // Deterministic 42-cell month: Aug 2026 starts on a Saturday, so
  // Monday-first pad = 5 leading nulls, days 1..31, trailing nulls to 42.
  const out: MonthGridCell[] = [];
  const leadingPad = 5;
  for (let i = 0; i < leadingPad; i++) {
    out.push({
      day: null, dayNum: null, isToday: false, isPast: false, isSelected: false, inRange: false,
      chips: [], moreCount: 0,
    });
  }
  for (let day = 1; day <= 31; day++) {
    out.push({
      day: new Date(2026, 7, day),
      dayNum: day,
      isToday: day === 15,
      isPast: false,
      isSelected: day === 20,
      inRange: day === 20,
      chips: day === 10
        ? [
            {
              title: 'Show A',
              time: '19:00',
              tone: 'success',
              meter: [{ filled: true }, { filled: true }, { filled: false }],
            },
            { title: 'Show B', time: '20:30', tone: 'warning' },
          ]
        : [],
      moreCount: day === 10 ? 1 : 0,
      flag: day === 10 ? { text: '-2', tone: 'warning' } : undefined,
    });
  }
  while (out.length < 42) {
    out.push({
      day: null, dayNum: null, isToday: false, isPast: false, isSelected: false, inRange: false,
      chips: [], moreCount: 0,
    });
  }
  return out;
}

describe('MonthGrid', () => {
  it('renders Mon-Sun header order', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    const headers = screen.getAllByTestId('month-grid-weekday');
    expect(headers.map(h => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('renders "+1 more" overflow text for a cell with moreCount', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('marks the today cell with a top-edge accent bar, not a filled circle', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    const todayCell = screen.getByTestId('month-grid-cell-2026-08-15');
    expect(todayCell).toHaveAttribute('data-today', 'true');
    expect(todayCell.className).toContain('relative');

    const marker = screen.getByTestId('month-grid-today-marker');
    expect(todayCell.contains(marker)).toBe(true);
    expect(marker.className).toContain('absolute');
    expect(marker.className).toContain('top-0');
    expect(marker.className).toContain('bg-primary');
    // no other cell renders a marker
    expect(screen.queryAllByTestId('month-grid-today-marker')).toHaveLength(1);
  });

  it('marks the selected + in-range cell', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    const selectedCell = screen.getByTestId('month-grid-cell-2026-08-20');
    expect(selectedCell).toHaveAttribute('data-selected', 'true');
    expect(selectedCell).toHaveAttribute('data-in-range', 'true');
  });

  it('fires onSelectDay with the clicked Date when a day cell is clicked', () => {
    const onSelectDay = vi.fn();
    render(<MonthGrid cells={buildCells()} onSelectDay={onSelectDay} onOpenDay={vi.fn()} />);
    const cell = screen.getByTestId('month-grid-cell-2026-08-10');
    fireEvent.click(cell);
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    const calledWith = onSelectDay.mock.calls[0][0] as Date;
    expect(calledWith.getFullYear()).toBe(2026);
    expect(calledWith.getMonth()).toBe(7);
    expect(calledWith.getDate()).toBe(10);
  });

  it('renders a chip with a flush tone-colored left rail and time+meter on one row', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    const chip = screen.getByTestId('month-grid-chip-2026-08-10-0');
    expect(chip.className).toContain('border-l-2');
    expect(chip.className).toMatch(/border-success/);

    const meterRow = screen.getByTestId('month-grid-chip-meter-row-2026-08-10-0');
    expect(meterRow.className).toContain('flex');
    expect(meterRow.className).toContain('items-center');
    const time = screen.getByText('19:00');
    const meter = screen.getByTestId('fill-meter');
    expect(meterRow.contains(time)).toBe(true);
    expect(meterRow.contains(meter)).toBe(true);
    expect(meter).toHaveAttribute('data-size', 'chip');
  });

  it('keyboard: Enter fires onOpenDay, Space fires onSelectDay, on a focused day cell', () => {
    const onSelectDay = vi.fn();
    const onOpenDay = vi.fn();
    render(<MonthGrid cells={buildCells()} onSelectDay={onSelectDay} onOpenDay={onOpenDay} />);
    const cell = screen.getByTestId('month-grid-cell-2026-08-12');
    cell.focus();
    expect(cell).toHaveFocus();

    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).not.toHaveBeenCalled();
    const openedWith = onOpenDay.mock.calls[0][0] as Date;
    expect(openedWith.getDate()).toBe(12);

    fireEvent.keyDown(cell, { key: ' ' });
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    const selectedWith = onSelectDay.mock.calls[0][0] as Date;
    expect(selectedWith.getDate()).toBe(12);
  });

  it('keyboard: Space fires onPeekDay (not onSelectDay) when onPeekDay is provided', () => {
    const onSelectDay = vi.fn();
    const onPeekDay = vi.fn();
    render(
      <MonthGrid
        cells={buildCells()}
        onSelectDay={onSelectDay}
        onOpenDay={vi.fn()}
        onPeekDay={onPeekDay}
      />
    );
    const cell = screen.getByTestId('month-grid-cell-2026-08-12');
    cell.focus();

    fireEvent.keyDown(cell, { key: ' ' });
    expect(onPeekDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).not.toHaveBeenCalled();
    const peekedWith = onPeekDay.mock.calls[0][0] as Date;
    expect(peekedWith.getDate()).toBe(12);
  });

  it('keyboard: Space still fires onSelectDay when no onPeekDay is provided', () => {
    const onSelectDay = vi.fn();
    render(<MonthGrid cells={buildCells()} onSelectDay={onSelectDay} onOpenDay={vi.fn()} />);
    const cell = screen.getByTestId('month-grid-cell-2026-08-12');
    cell.focus();

    fireEvent.keyDown(cell, { key: ' ' });
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    const selectedWith = onSelectDay.mock.calls[0][0] as Date;
    expect(selectedWith.getDate()).toBe(12);
  });

  describe('range selection (drag + shift-click)', () => {
    function renderRangeGrid() {
      const onSelectDay = vi.fn();
      const onRangeStart = vi.fn();
      const onRangeExtend = vi.fn();
      const onRangeCommit = vi.fn();
      render(
        <MonthGrid
          cells={buildCells()}
          onSelectDay={onSelectDay}
          onOpenDay={vi.fn()}
          onRangeStart={onRangeStart}
          onRangeExtend={onRangeExtend}
          onRangeCommit={onRangeCommit}
        />
      );
      return { onSelectDay, onRangeStart, onRangeExtend, onRangeCommit };
    }

    it('a drag across cells (mousedown A, mouseenter C, mouseup) fires start/extend/commit in order, not onSelectDay', () => {
      const { onSelectDay, onRangeStart, onRangeExtend, onRangeCommit } = renderRangeGrid();
      const cellA = screen.getByTestId('month-grid-cell-2026-08-05');
      const cellC = screen.getByTestId('month-grid-cell-2026-08-07');

      fireEvent.mouseDown(cellA);
      // No movement yet — starting a drag must stay silent until the pointer
      // actually leaves the anchor cell (see the "plain click" test below).
      expect(onRangeStart).not.toHaveBeenCalled();

      fireEvent.mouseEnter(cellC);
      expect(onRangeStart).toHaveBeenCalledTimes(1);
      expect(onRangeStart).toHaveBeenCalledWith('2026-08-05');
      expect(onRangeExtend).toHaveBeenCalledTimes(1);
      expect(onRangeExtend).toHaveBeenCalledWith('2026-08-07');

      // onRangeStart must fire before onRangeExtend.
      const startOrder = onRangeStart.mock.invocationCallOrder[0];
      const extendOrder = onRangeExtend.mock.invocationCallOrder[0];
      expect(startOrder).toBeLessThan(extendOrder);

      fireEvent.mouseUp(cellC);
      expect(onRangeCommit).toHaveBeenCalledTimes(1);
      expect(onSelectDay).not.toHaveBeenCalled();
    });

    it('mouseup outside the grid (window) still commits an in-progress drag', () => {
      const { onRangeStart, onRangeExtend, onRangeCommit } = renderRangeGrid();
      const cellA = screen.getByTestId('month-grid-cell-2026-08-05');
      const cellC = screen.getByTestId('month-grid-cell-2026-08-07');

      fireEvent.mouseDown(cellA);
      fireEvent.mouseEnter(cellC);
      expect(onRangeStart).toHaveBeenCalledTimes(1);
      expect(onRangeExtend).toHaveBeenCalledTimes(1);

      fireEvent.mouseUp(window);
      expect(onRangeCommit).toHaveBeenCalledTimes(1);
    });

    it('shift+click on a cell fires onRangeExtend without starting a new drag', () => {
      const { onSelectDay, onRangeStart, onRangeExtend, onRangeCommit } = renderRangeGrid();
      const cellE = screen.getByTestId('month-grid-cell-2026-08-09');
      const cellF = screen.getByTestId('month-grid-cell-2026-08-11');

      fireEvent.mouseDown(cellE, { shiftKey: true });
      expect(onRangeExtend).toHaveBeenCalledTimes(1);
      expect(onRangeExtend).toHaveBeenCalledWith('2026-08-09');
      expect(onRangeStart).not.toHaveBeenCalled();

      // No drag was armed by the shift-click, so a later mouseenter/mouseup
      // must not fire any further range callbacks.
      fireEvent.mouseEnter(cellF);
      expect(onRangeExtend).toHaveBeenCalledTimes(1);

      fireEvent.mouseUp(cellF);
      expect(onRangeCommit).not.toHaveBeenCalled();
      expect(onSelectDay).not.toHaveBeenCalled();
    });

    it('shift-click does not also fire onSelectDay (the click handler is suppressed for a shift-modified click)', () => {
      const { onSelectDay, onRangeStart, onRangeExtend, onRangeCommit } = renderRangeGrid();
      const cellE = screen.getByTestId('month-grid-cell-2026-08-09');

      // A real browser shift-click dispatches mousedown, mouseup, and click,
      // all carrying shiftKey: true — mousedown already extends the range;
      // the click must not also relocate selectedDay via onSelectDay.
      fireEvent.mouseDown(cellE, { shiftKey: true });
      fireEvent.mouseUp(cellE, { shiftKey: true });
      fireEvent.click(cellE, { shiftKey: true });

      expect(onRangeExtend).toHaveBeenCalledTimes(1);
      expect(onRangeExtend).toHaveBeenCalledWith('2026-08-09');
      expect(onRangeStart).not.toHaveBeenCalled();
      expect(onRangeCommit).not.toHaveBeenCalled();
      expect(onSelectDay).not.toHaveBeenCalled();
    });

    it('a plain click with no movement fires only onSelectDay, no range callbacks', () => {
      const { onSelectDay, onRangeStart, onRangeExtend, onRangeCommit } = renderRangeGrid();
      const cellA = screen.getByTestId('month-grid-cell-2026-08-05');

      fireEvent.mouseDown(cellA);
      fireEvent.mouseUp(cellA);
      fireEvent.click(cellA);

      expect(onSelectDay).toHaveBeenCalledTimes(1);
      const selectedWith = onSelectDay.mock.calls[0][0] as Date;
      expect(selectedWith.getDate()).toBe(5);
      expect(onRangeStart).not.toHaveBeenCalled();
      expect(onRangeExtend).not.toHaveBeenCalled();
      expect(onRangeCommit).not.toHaveBeenCalled();
    });

    it('renders inRange styling unaffected by the new handlers', () => {
      renderRangeGrid();
      const rangedCell = screen.getByTestId('month-grid-cell-2026-08-20');
      expect(rangedCell).toHaveAttribute('data-in-range', 'true');
      expect(rangedCell.className).toContain('bg-accent-50');
    });
  });

  describe('dense (mobile) variant', () => {
    it('without dense: cell uses the desktop min-height and still shows up to 2 chips', () => {
      render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
      const cell = screen.getByTestId('month-grid-cell-2026-08-10');
      expect(cell.className).toContain('min-h-[104px]');
      expect(cell.className).not.toContain('min-h-[62px]');
      expect(screen.getByTestId('month-grid-chip-2026-08-10-0')).toBeInTheDocument();
      expect(screen.getByTestId('month-grid-chip-2026-08-10-1')).toBeInTheDocument();
      expect(screen.getByText('+1 more')).toBeInTheDocument();
    });

    it('with dense: cell uses the compact min-height', () => {
      render(<MonthGrid dense cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
      const cell = screen.getByTestId('month-grid-cell-2026-08-10');
      expect(cell.className).toContain('min-h-[62px]');
      expect(cell.className).not.toContain('min-h-[104px]');
    });

    it('with dense: a cell with 2 chips renders only 1, and the overflow count absorbs the hidden one', () => {
      render(<MonthGrid dense cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
      // Only the first chip renders...
      expect(screen.getByTestId('month-grid-chip-2026-08-10-0')).toBeInTheDocument();
      // ...the second chip is capped, not rendered...
      expect(screen.queryByTestId('month-grid-chip-2026-08-10-1')).not.toBeInTheDocument();
      // ...and the existing moreCount (1) is bumped by the 1 hidden chip, so no data is lost.
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('with dense: today ring and onSelectDay tap still work', () => {
      const onSelectDay = vi.fn();
      render(<MonthGrid dense cells={buildCells()} onSelectDay={onSelectDay} onOpenDay={vi.fn()} />);
      const todayCell = screen.getByTestId('month-grid-cell-2026-08-15');
      expect(todayCell).toHaveAttribute('data-today', 'true');
      expect(screen.getByTestId('month-grid-today-marker')).toBeInTheDocument();

      const cell = screen.getByTestId('month-grid-cell-2026-08-12');
      fireEvent.click(cell);
      expect(onSelectDay).toHaveBeenCalledTimes(1);
      const selectedWith = onSelectDay.mock.calls[0][0] as Date;
      expect(selectedWith.getDate()).toBe(12);
    });
  });
});
