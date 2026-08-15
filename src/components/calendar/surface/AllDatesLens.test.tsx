import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AllDatesLens } from './AllDatesLens';
import type { ArtistDateEntry } from '@/lib/calendar/types';

const TODAY = new Date(2026, 7, 10); // 2026-08-10

function entry(overrides: Partial<ArtistDateEntry> = {}): ArtistDateEntry {
  return {
    id: 'ad-1',
    date: new Date(2026, 7, 12),
    bookingId: 'bk-1',
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: null,
    session1: '19:00',
    myStatus: 'confirmed',
    hireOrderId: null,
    ...overrides,
  };
}

describe('AllDatesLens', () => {
  it('renders the table header with Session (not Call)', () => {
    render(<AllDatesLens entries={[]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />);

    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('My status')).toBeInTheDocument();
  });

  it('a confirmed entry with a hireOrderId renders a link to the hire order via hireOrderHref', () => {
    const e = entry({ id: 'ad-1', myStatus: 'confirmed', hireOrderId: 'ho-9' });

    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    const link = screen.getByTestId('all-dates-link-ad-1');
    expect(link).toHaveAttribute('href', '/hire-orders/ho-9');
    expect(link).toHaveTextContent('Hire order');
    expect(screen.queryByTestId('all-dates-block-ad-1')).not.toBeInTheDocument();
  });

  it('an unanswered future entry renders a Block date button and fires onBlock(dateId, date)', () => {
    const e = entry({ id: 'ad-2', myStatus: 'unanswered', hireOrderId: null, date: new Date(2026, 7, 20) });
    const onBlock = vi.fn();

    render(
      <AllDatesLens entries={[e]} onBlock={onBlock} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    const btn = screen.getByTestId('all-dates-block-ad-2');
    expect(btn).toHaveTextContent('Block date');
    fireEvent.click(btn);
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenCalledWith('ad-2', e.date);
  });

  it('a past unanswered entry renders no action at all', () => {
    const e = entry({ id: 'ad-3', myStatus: 'unanswered', hireOrderId: null, date: new Date(2026, 7, 1) });

    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    expect(screen.queryByTestId('all-dates-block-ad-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('all-dates-link-ad-3')).not.toBeInTheDocument();
  });

  it('a confirmed entry without a hireOrderId renders no action', () => {
    const e = entry({ id: 'ad-4', myStatus: 'confirmed', hireOrderId: null });

    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    expect(screen.queryByTestId('all-dates-link-ad-4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('all-dates-block-ad-4')).not.toBeInTheDocument();
  });

  it('renders the row date/day/title/venue/session and a status badge', () => {
    const e = entry({ id: 'ad-1', program: 'Cirque Noir', venue: 'Big Top', session1: '19:00', myStatus: 'soft_booked' });

    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    const row = screen.getByTestId('all-dates-row-ad-1');
    expect(row).toHaveTextContent('Cirque Noir');
    expect(row).toHaveTextContent('Big Top');
    expect(row).toHaveTextContent('19:00');
    expect(row).toHaveTextContent('Hold');
  });
});
