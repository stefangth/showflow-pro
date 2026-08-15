import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OffersLens } from './OffersLens';
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
    myStatus: 'suggested',
    hireOrderId: null,
    ...overrides,
  };
}

describe('OffersLens', () => {
  it('renders a queue card for a suggested offer and one for an upcoming hold', () => {
    const suggested = entry({ id: 'ad-1', myStatus: 'suggested', bookingId: 'bk-1' });
    const hold = entry({ id: 'ad-2', myStatus: 'soft_booked', bookingId: 'bk-2', date: new Date(2026, 7, 14) });

    render(
      <OffersLens
        entries={[suggested, hold]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onBlock={vi.fn()}
        answeredToday={[]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('offer-card-ad-1')).toBeInTheDocument();
    expect(screen.getByTestId('offer-card-ad-2')).toBeInTheDocument();
  });

  it('clicking Accept on a live offer fires onAccept with the bookingId', () => {
    const suggested = entry({ id: 'ad-1', myStatus: 'suggested', bookingId: 'bk-1' });
    const onAccept = vi.fn();

    render(
      <OffersLens
        entries={[suggested]}
        onAccept={onAccept}
        onDecline={vi.fn()}
        onBlock={vi.fn()}
        answeredToday={[]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    fireEvent.click(screen.getByTestId('offer-accept-ad-1'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('bk-1');
  });

  it('clicking Decline fires onDecline and clicking Block date fires onBlock with dateId+date', () => {
    const suggested = entry({ id: 'ad-1', myStatus: 'suggested', bookingId: 'bk-1' });
    const onDecline = vi.fn();
    const onBlock = vi.fn();

    render(
      <OffersLens
        entries={[suggested]}
        onAccept={vi.fn()}
        onDecline={onDecline}
        onBlock={onBlock}
        answeredToday={[]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    fireEvent.click(screen.getByTestId('offer-decline-ad-1'));
    expect(onDecline).toHaveBeenCalledWith('bk-1');

    fireEvent.click(screen.getByTestId('offer-block-ad-1'));
    expect(onBlock).toHaveBeenCalledWith('ad-1', suggested.date);
  });

  it('a hold (soft_booked) card shows a Hold chip instead of Accept/Decline', () => {
    const hold = entry({ id: 'ad-2', myStatus: 'soft_booked', bookingId: 'bk-2' });

    render(
      <OffersLens
        entries={[hold]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onBlock={vi.fn()}
        answeredToday={[]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    expect(screen.getByText('Hold')).toBeInTheDocument();
    expect(screen.queryByTestId('offer-accept-ad-2')).not.toBeInTheDocument();
  });

  it('a past soft_booked entry is excluded from the queue', () => {
    const pastHold = entry({ id: 'ad-3', myStatus: 'soft_booked', date: new Date(2026, 7, 1) });

    render(
      <OffersLens
        entries={[pastHold]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onBlock={vi.fn()}
        answeredToday={[]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    expect(screen.queryByTestId('offer-card-ad-3')).not.toBeInTheDocument();
  });

  it('renders the progress label as answered/(answered+open offers)', () => {
    const suggested1 = entry({ id: 'ad-1', myStatus: 'suggested' });
    const suggested2 = entry({ id: 'ad-2', myStatus: 'suggested', date: new Date(2026, 7, 13) });

    render(
      <OffersLens
        entries={[suggested1, suggested2]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onBlock={vi.fn()}
        answeredToday={[{ date: '08/08', title: 'Cirque Noir', venue: 'Big Top', label: 'Accepted', badgeClass: 'bg-success/10 text-success' }]}
        notOfferedYet={[]}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('offers-progress-label')).toHaveTextContent('1 of 3 answered');
  });

  it('renders the "Answered today" rows and the "not offered yet" rows with a working Block button', () => {
    const onBlock = vi.fn();
    const notOffered = entry({ id: 'ad-5', myStatus: 'unanswered', bookingId: null, date: new Date(2026, 7, 20) });

    render(
      <OffersLens
        entries={[]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onBlock={onBlock}
        answeredToday={[
          { date: '08/08', title: 'Cirque Noir', venue: 'Big Top', label: 'Accepted', badgeClass: 'bg-success/10 text-success' },
        ]}
        notOfferedYet={[notOffered]}
        today={TODAY}
      />
    );

    expect(screen.getByTestId('answered-row-0')).toHaveTextContent('Cirque Noir');
    expect(screen.getByTestId('answered-row-0')).toHaveTextContent('Accepted');

    fireEvent.click(screen.getByTestId('not-offered-block-ad-5'));
    expect(onBlock).toHaveBeenCalledWith('ad-5', notOffered.date);
  });
});
