import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthLens } from './MonthLens';
import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';

describe('MonthLens', () => {
  it('producer: renders a chip + deficit flag for a date in the anchor month, and clicking a day fires onSelectDay', () => {
    const entries: ProducerDateEntry[] = [
      {
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
      },
    ];
    const onSelectDay = vi.fn();
    render(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={onSelectDay}
        onOpenDay={vi.fn()}
        producerEntries={entries}
        today={new Date(2026, 7, 15)}
      />
    );

    expect(screen.getByText('Cirque Noir')).toBeInTheDocument();
    // deficit = mainSlots(6) - confirmedMain(3) = 3, rendered as the U+2212 minus glyph
    expect(screen.getByText('−3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('month-grid-cell-2026-08-12'));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    const calledWith = onSelectDay.mock.calls[0][0] as Date;
    expect(calledWith.getDate()).toBe(12);
  });

  it('producer: double-clicking a day fires onOpenDay', () => {
    const onOpenDay = vi.fn();
    render(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={vi.fn()}
        onOpenDay={onOpenDay}
        producerEntries={[]}
        today={new Date(2026, 7, 15)}
      />
    );
    fireEvent.doubleClick(screen.getByTestId('month-grid-cell-2026-08-12'));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });

  it('artist: shows the "answer" flag on a suggested-offer date', () => {
    const entries: ArtistDateEntry[] = [
      {
        id: 'ad-1',
        date: new Date(2026, 7, 10),
        bookingId: null,
        program: 'Cirque Noir',
        subProgram: null,
        venue: 'Big Top',
        city: null,
        session1: '19:00',
        myStatus: 'suggested',
        hireOrderId: null,
      },
    ];
    render(
      <MonthLens
        role="artist"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={vi.fn()}
        onOpenDay={vi.fn()}
        artistEntries={entries}
        today={new Date(2026, 7, 15)}
      />
    );
    expect(screen.getByText('answer')).toBeInTheDocument();
  });

  it('forwards onPeekDay to MonthGrid: Space on a focused cell fires onPeekDay, not onSelectDay', () => {
    const onSelectDay = vi.fn();
    const onPeekDay = vi.fn();
    render(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={onSelectDay}
        onOpenDay={vi.fn()}
        onPeekDay={onPeekDay}
        producerEntries={[]}
        today={new Date(2026, 7, 15)}
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

  it('forwards rangeActive to MonthGrid, applying select-none to cells while a range is active', () => {
    // Regression: MonthGrid grew a `rangeActive` prop (select-none during a
    // drag) but MonthLens never declared/forwarded it.
    const { rerender } = render(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={vi.fn()}
        onOpenDay={vi.fn()}
        producerEntries={[]}
        today={new Date(2026, 7, 15)}
        rangeActive={false}
      />
    );
    expect(screen.getByTestId('month-grid-cell-2026-08-12')).not.toHaveClass('select-none');

    rerender(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={null}
        onSelectDay={vi.fn()}
        onOpenDay={vi.fn()}
        producerEntries={[]}
        today={new Date(2026, 7, 15)}
        rangeActive={true}
      />
    );
    expect(screen.getByTestId('month-grid-cell-2026-08-12')).toHaveClass('select-none');
  });

  it('marks the selected day cell via the selectedDay prop', () => {
    render(
      <MonthLens
        role="producer"
        anchor={new Date(2026, 7, 1)}
        selectedDay={new Date(2026, 7, 20)}
        onSelectDay={vi.fn()}
        onOpenDay={vi.fn()}
        producerEntries={[]}
        today={new Date(2026, 7, 15)}
      />
    );
    expect(screen.getByTestId('month-grid-cell-2026-08-20')).toHaveAttribute('data-selected', 'true');
  });
});
