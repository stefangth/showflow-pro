import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeekLens } from './WeekLens';
import type { ProducerDateEntry } from '@/lib/calendar/types';

// Deterministic anchor: Fri 14 Aug 2026 -> week window is Mon 10 Aug .. Sun 16 Aug
// (mirrors src/lib/calendar/weekData.test.ts).
const ANCHOR = new Date(2026, 7, 14);
// Deterministic "today" override, independent of the system clock: Wed 12 Aug,
// the same day as the timed entry below -> columnIndex 2.
const TODAY = new Date(2026, 7, 12);

function makeEntry(overrides: Partial<ProducerDateEntry> & Pick<ProducerDateEntry, 'id' | 'date'>): ProducerDateEntry {
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
    confirmedMain: 4,
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

describe('WeekLens', () => {
  it('renders 2 positioned blocks for a multi-session date and a chip for an untimed date; clicking a block opens its entry', () => {
    const timedEntry = makeEntry({
      id: 'sd-timed',
      date: new Date(2026, 7, 12), // Wed 12 Aug
      session1: '14:00:00',
      session2: '19:30:00',
      mainSlots: 6,
      confirmedMain: 4,
    });
    const untimedEntry = makeEntry({
      id: 'sd-untimed',
      date: new Date(2026, 7, 13), // Thu 13 Aug
    });

    const onOpenEntry = vi.fn();
    render(
      <WeekLens entries={[timedEntry, untimedEntry]} anchor={ANCHOR} onOpenEntry={onOpenEntry} today={TODAY} />
    );

    const block1 = screen.getByTestId('week-block-sd-timed-1');
    const block2 = screen.getByTestId('week-block-sd-timed-2');
    expect(block1).toBeInTheDocument();
    expect(block2).toBeInTheDocument();

    // band = 14:00..20:00 (from the two session times), so block1 (14:00) sits
    // at the top of the grid and block2 (19:30) is 5.5 hours down.
    expect(block1).toHaveStyle({ top: '0px' });
    expect(block2).toHaveStyle({ top: '242px' }); // 5.5h * 44px/h

    expect(block1).toHaveTextContent('14:00');
    expect(block1).toHaveTextContent('Aida');
    expect(block1).toHaveTextContent('Opera House');
    expect(block1).toHaveTextContent('Berlin');
    expect(block1).toHaveTextContent('4/6');

    const untimedChip = screen.getByTestId('week-untimed-sd-untimed');
    expect(untimedChip).toBeInTheDocument();
    expect(untimedChip).toHaveTextContent('Aida');

    fireEvent.click(block1);
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).toHaveBeenCalledWith('sd-timed');

    fireEvent.click(untimedChip);
    expect(onOpenEntry).toHaveBeenCalledTimes(2);
    expect(onOpenEntry).toHaveBeenCalledWith('sd-untimed');
  });

  it('stacks multiple session blocks for the same date in the same column', () => {
    const entry = makeEntry({
      id: 'sd-multi',
      date: new Date(2026, 7, 11), // Tue 11 Aug -> columnIndex 1
      session1: '14:00:00',
      session2: '17:00:00',
      session3: '20:00:00',
    });
    render(<WeekLens entries={[entry]} anchor={ANCHOR} onOpenEntry={vi.fn()} today={TODAY} />);

    expect(screen.getByTestId('week-block-sd-multi-1')).toBeInTheDocument();
    expect(screen.getByTestId('week-block-sd-multi-2')).toBeInTheDocument();
    expect(screen.getByTestId('week-block-sd-multi-3')).toBeInTheDocument();
  });

  it('tints the today column and leaves the others untinted', () => {
    render(<WeekLens entries={[]} anchor={ANCHOR} onOpenEntry={vi.fn()} today={TODAY} />);

    const todayColumn = screen.getByTestId('week-column-2026-08-12');
    expect(todayColumn).toHaveAttribute('data-today', 'true');

    const otherColumn = screen.getByTestId('week-column-2026-08-10');
    expect(otherColumn).toHaveAttribute('data-today', 'false');
  });

  it('renders whole-hour gutter labels spanning the band', () => {
    const entry = makeEntry({
      id: 'sd-band',
      date: new Date(2026, 7, 12),
      session1: '14:00:00',
      session2: '19:30:00',
    });
    render(<WeekLens entries={[entry]} anchor={ANCHOR} onOpenEntry={vi.fn()} today={TODAY} />);

    // band = 14:00..20:00 padded to whole hours (bandBounds).
    expect(screen.getByTestId('week-hour-840')).toHaveTextContent('14:00');
    expect(screen.getByTestId('week-hour-1200')).toHaveTextContent('20:00');
  });

  it('renders no blocks and no untimed chips when no entries fall in the anchor week', () => {
    render(<WeekLens entries={[]} anchor={ANCHOR} onOpenEntry={vi.fn()} today={TODAY} />);
    expect(screen.queryByTestId(/^week-block-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^week-untimed-/)).not.toBeInTheDocument();
  });
});
