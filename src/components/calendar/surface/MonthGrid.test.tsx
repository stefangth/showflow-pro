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
            { title: 'Show A', time: '19:00', tone: 'success' },
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

  it('marks the today cell', () => {
    render(<MonthGrid cells={buildCells()} onSelectDay={vi.fn()} onOpenDay={vi.fn()} />);
    const todayCell = screen.getByTestId('month-grid-cell-2026-08-15');
    expect(todayCell).toHaveAttribute('data-today', 'true');
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
});
