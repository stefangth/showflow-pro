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
    expect(link).toHaveTextContent('Contract');
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

  it('formats a raw HH:MM:SS session value as HH:MM, not the raw string', () => {
    const e = entry({ id: 'ad-6', session1: '18:00:00' });

    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    const row = screen.getByTestId('all-dates-row-ad-6');
    expect(row).toHaveTextContent('18:00');
    expect(row).not.toHaveTextContent('18:00:00');
  });

  it('a row stacks single-column by default (mobile) with md: classes restoring the desktop table row, and the header hides until md:', () => {
    const e = entry({ id: 'ad-1' });
    render(
      <AllDatesLens entries={[e]} onBlock={vi.fn()} hireOrderHref={(id) => `/hire-orders/${id}`} today={TODAY} />
    );

    const row = screen.getByTestId('all-dates-row-ad-1');
    // Mobile-first: the row is a vertical stack (no fixed table columns);
    // `md:` restores the desktop single-line row exactly at >=768px.
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toMatch(/\bmd:flex-row\b/);

    // The header row (Date/Day/Show/Session/My status column labels) only
    // reads sensibly once the row is a table again — hidden until md:.
    const header = screen.getByText('Date').parentElement;
    expect(header?.className).toMatch(/\bhidden\b/);
    expect(header?.className).toMatch(/\bmd:flex\b/);

    // The show block is full width on mobile, restoring its flexible
    // desktop sizing only at md:.
    const title = screen.getByText('Cirque Noir');
    expect(title.parentElement?.className).toMatch(/\bw-full\b/);
    expect(title.parentElement?.className).toMatch(/\bmd:flex-1\b/);
  });
});
