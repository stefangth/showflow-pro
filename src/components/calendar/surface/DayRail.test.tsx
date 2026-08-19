import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { DayRail } from './DayRail';
import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';

function producerEntry(overrides: Partial<ProducerDateEntry> = {}): ProducerDateEntry {
  return {
    id: 'pd-1',
    date: new Date(2026, 7, 20),
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
    date: new Date(2026, 7, 20),
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

describe('DayRail characterization (pre-DayDetail-extraction baseline)', () => {
  // Full-fidelity snapshots of DayRail's rendered DOM, taken BEFORE the
  // DayDetail extraction. These must keep passing UNCHANGED after DayRail is
  // rewritten to delegate to DayDetail — that's the proof the desktop output
  // stayed byte-identical across the refactor.
  it('producer: full rail markup (header, entry card w/ fill meter + order badge, primary/secondary, stats, legend)', () => {
    const { container } = render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[
          producerEntry({ acceptedMain: 2, hireOrderId: 'ho-1', hireOrderStatus: 'issued' }),
        ]}
        stats={[{ label: 'Confirmed this week', value: '12', dotClass: 'bg-success' }]}
        legend={[{ label: 'Fully filled', badgeClass: 'bg-success/10 text-success', railClass: 'bg-success' }]}
        onPrimary={vi.fn()}
        onSecondary={vi.fn()}
      />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('producer: empty-day rail markup', () => {
    const { container } = render(
      <DayRail role="producer" day={new Date(2026, 7, 20)} producerEntries={[]} stats={[]} legend={[]} />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('artist: full rail markup (header, status-note entry card, primary/secondary, stats, legend)', () => {
    const { container } = render(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'suggested' })]}
        stats={[{ label: 'Offers open', value: '2', dotClass: 'bg-warning' }]}
        legend={[{ label: 'Offer', badgeClass: 'bg-warning/10 text-warning', railClass: 'bg-warning' }]}
        onPrimary={vi.fn()}
        onSecondary={vi.fn()}
      />
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('DayRail', () => {
  it('producer: shows "Confirm holds" as primary when acceptedMain>0 and fires onPrimary', () => {
    const onPrimary = vi.fn();
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        stats={[{ label: 'Confirmed', value: '3', dotClass: 'bg-success' }]}
        legend={[{ label: 'Fully filled', badgeClass: 'bg-success/10 text-success', railClass: 'bg-success' }]}
        onPrimary={onPrimary}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Confirm holds');
    fireEvent.click(btn);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('producer: shows "Generate hire order" as primary when fully filled with no accepted holds', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ status: 'fully_filled', acceptedMain: 0, confirmedMain: 6 })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByTestId('day-rail-primary')).toHaveTextContent('Generate hire order');
  });

  it('producer: does not offer "Generate hire order" when the fully-filled date already has an active order', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[
          producerEntry({
            status: 'fully_filled',
            acceptedMain: 0,
            confirmedMain: 6,
            hireOrderId: 'ho-1',
            hireOrderStatus: 'issued',
          }),
        ]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.queryByTestId('day-rail-primary')).not.toBeInTheDocument();
    // Falls through to the rail's default secondary "Open date" action.
    expect(screen.getByTestId('day-rail-secondary')).toHaveTextContent('Open date');
    expect(screen.getByText('Awaiting countersign')).toBeInTheDocument();
  });

  it('producer: no primary button when neither condition applies', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ status: 'open', acceptedMain: 0 })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.queryByTestId('day-rail-primary')).not.toBeInTheDocument();
  });

  it('artist: shows "Answer the ask" as primary when myStatus is suggested and fires onPrimary', () => {
    const onPrimary = vi.fn();
    render(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'suggested' })]}
        stats={[]}
        legend={[]}
        onPrimary={onPrimary}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Answer the ask');
    fireEvent.click(btn);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('artist: shows "Block date" as primary when unanswered', () => {
    render(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'unanswered' })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByTestId('day-rail-primary')).toHaveTextContent('Block date');
  });

  it('renders role-appropriate secondary default labels and fires onSecondary', () => {
    const onSecondary = vi.fn();
    const { rerender } = render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
        stats={[]}
        legend={[]}
        onSecondary={onSecondary}
      />
    );
    const secondary = screen.getByTestId('day-rail-secondary');
    expect(secondary).toHaveTextContent('Open date');
    fireEvent.click(secondary);
    expect(onSecondary).toHaveBeenCalledTimes(1);

    rerender(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry()]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByTestId('day-rail-secondary')).toHaveTextContent('Message producer');
  });

  it('renders stats rows (dot/label/value)', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
        stats={[{ label: 'Confirmed this week', value: '12', dotClass: 'bg-success' }]}
        legend={[]}
      />
    );
    expect(screen.getByText('Confirmed this week')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders legend rows', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
        stats={[]}
        legend={[{ label: 'Fully filled', badgeClass: 'bg-success/10 text-success', railClass: 'bg-success' }]}
      />
    );
    expect(screen.getByText('Fully filled')).toBeInTheDocument();
  });

  it('producer entry with slots renders a FillMeter, not a status note', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ mainSlots: 6, confirmedMain: 3 })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByTestId('fill-meter')).toBeInTheDocument();
    expect(screen.getByText('3/6 main')).toBeInTheDocument();
  });

  it('producer entry with no main slots renders a status note instead of a meter', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ mainSlots: 0, status: 'unconfigured' })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByText('Unconfigured')).toBeInTheDocument();
    expect(screen.queryByTestId('fill-meter')).not.toBeInTheDocument();
  });

  it('artist entry renders a status note (no fill meter)', () => {
    render(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'confirmed' })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('fill-meter')).not.toBeInTheDocument();
  });

  it('renders an empty-state note when the day has no entries', () => {
    render(
      <DayRail role="producer" day={new Date(2026, 7, 20)} producerEntries={[]} stats={[]} legend={[]} />
    );
    expect(screen.getByTestId('day-rail-empty')).toBeInTheDocument();
  });

  it('producer: header derives casting/fully-filled eyebrow, title, and "This month" stats title', () => {
    const { rerender } = render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ mainSlots: 6, confirmedMain: 3 })]}
        stats={[]}
        legend={[]}
      />
    );
    const header = screen.getByTestId('day-rail-header');
    expect(header).toHaveTextContent('Thu 20 Aug');
    expect(header).toHaveTextContent('casting');
    expect(header).toHaveTextContent('Cirque Noir');
    expect(screen.getByText('This month')).toBeInTheDocument();

    rerender(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ status: 'fully_filled', mainSlots: 6, confirmedMain: 6 })]}
        stats={[]}
        legend={[]}
      />
    );
    expect(screen.getByTestId('day-rail-header')).toHaveTextContent('fully filled');
  });

  it('renders the "nothing scheduled" eyebrow and select-a-day sub when the day is empty', () => {
    render(
      <DayRail role="producer" day={new Date(2026, 7, 20)} producerEntries={[]} stats={[]} legend={[]} />
    );
    const header = screen.getByTestId('day-rail-header');
    expect(header).toHaveTextContent('nothing scheduled');
    expect(header).toHaveTextContent('Pick a day');
    expect(header).toHaveTextContent('Select a day to see its dates and act on them.');
  });

  it('producer: disables the primary button and exposes the title when actionGates gates the resolved "confirmHolds" kind', () => {
    const onPrimary = vi.fn();
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        stats={[]}
        legend={[]}
        onPrimary={onPrimary}
        actionGates={{ confirmHolds: { disabled: true, title: "You don't have permission to confirm bookings" } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Confirm holds');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You don't have permission to confirm bookings");
    fireEvent.click(btn);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('producer: disables the primary button when actionGates gates the resolved "generateHireOrder" kind', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ status: 'fully_filled', acceptedMain: 0, confirmedMain: 6 })]}
        stats={[]}
        legend={[]}
        actionGates={{ generateHireOrder: { disabled: true, title: "No permission" } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Generate hire order');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'No permission');
  });

  it('producer: primary stays enabled when its gate has disabled: false', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        stats={[]}
        legend={[]}
        actionGates={{ confirmHolds: { disabled: false } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('title');
  });

  it('producer: a gate on a different kind does not affect the resolved primary button', () => {
    render(
      <DayRail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        stats={[]}
        legend={[]}
        actionGates={{ generateHireOrder: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Confirm holds');
    expect(btn).not.toBeDisabled();
  });

  it('artist: header eyebrow shows the lowercased status label', () => {
    render(
      <DayRail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'suggested' })]}
        stats={[]}
        legend={[]}
      />
    );
    const header = screen.getByTestId('day-rail-header');
    expect(header).toHaveTextContent('offer');
    expect(screen.getByText('Your August')).toBeInTheDocument();
  });
});
