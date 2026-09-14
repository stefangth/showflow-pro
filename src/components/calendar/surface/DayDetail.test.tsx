import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { DayDetail } from './DayDetail';
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

describe('DayDetail', () => {
  it('producer: shows "Confirm holds" as primary when acceptedMain>0 and fires onPrimary', () => {
    const onPrimary = vi.fn();
    render(
      <DayDetail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        onPrimary={onPrimary}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Book who said yes');
    fireEvent.click(btn);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('artist: shows "Answer the ask" as primary when myStatus is suggested and fires onPrimary', () => {
    const onPrimary = vi.fn();
    render(
      <DayDetail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'suggested' })]}
        onPrimary={onPrimary}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toHaveTextContent('Answer the ask');
    fireEvent.click(btn);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('producer entry with slots renders a FillMeter, not a status note', () => {
    render(
      <DayDetail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ mainSlots: 6, confirmedMain: 3 })]}
      />
    );
    expect(screen.getByTestId('fill-meter')).toBeInTheDocument();
    expect(screen.getByText('3/6 main')).toBeInTheDocument();
  });

  it('artist entry renders a status note (no fill meter)', () => {
    render(
      <DayDetail
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry({ myStatus: 'confirmed' })]}
      />
    );
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('fill-meter')).not.toBeInTheDocument();
  });

  it('renders the date-card header derived from role/day/entries', () => {
    render(
      <DayDetail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ mainSlots: 6, confirmedMain: 3 })]}
      />
    );
    const header = screen.getByTestId('day-rail-header');
    expect(header).toHaveTextContent('Thu 20 Aug');
    expect(header).toHaveTextContent('filling');
    expect(header).toHaveTextContent('Cirque Noir');
  });

  it('renders an empty-state note when the day has no entries', () => {
    render(<DayDetail role="producer" day={new Date(2026, 7, 20)} producerEntries={[]} />);
    expect(screen.getByTestId('day-rail-empty')).toBeInTheDocument();
  });

  it('disables the primary button and exposes the title when actionGates gates the resolved kind', () => {
    const onPrimary = vi.fn();
    render(
      <DayDetail
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry({ acceptedMain: 2 })]}
        onPrimary={onPrimary}
        actionGates={{ confirmHolds: { disabled: true, title: "You don't have permission to confirm bookings" } }}
      />
    );
    const btn = screen.getByTestId('day-rail-primary');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You don't have permission to confirm bookings");
    fireEvent.click(btn);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  describe('mobile info tiles (showInfoTiles)', () => {
    it('artist: renders Session + Expires tiles when the offer clock has started', () => {
      render(
        <DayDetail
          role="artist"
          day={new Date(2026, 7, 20)}
          artistEntries={[artistEntry({ myStatus: 'suggested', session1: '19:00', offerExpiresAt: '2026-08-20T17:00:00' })]}
          showInfoTiles
        />
      );
      expect(screen.getByTestId('day-detail-tiles')).toBeInTheDocument();
      expect(screen.getByTestId('day-detail-tile-session')).toHaveTextContent('19:00');
      expect(screen.getByTestId('day-detail-tile-expires')).toBeInTheDocument();
    });

    it('artist: on a multi-offer day the tiles follow the pending offer, not entries[0]', () => {
      // entries[0] is a confirmed booking with no expiry; entries[1] is the
      // pending offer the "Answer the ask" primary acts on. Tiles must describe
      // the offer, not the confirmed date.
      render(
        <DayDetail
          role="artist"
          day={new Date(2026, 7, 20)}
          artistEntries={[
            artistEntry({ id: 'ad-confirmed', myStatus: 'confirmed', session1: '14:00', offerExpiresAt: null }),
            artistEntry({ id: 'ad-offer', myStatus: 'suggested', session1: '19:00', offerExpiresAt: '2026-08-20T17:00:00' }),
          ]}
          showInfoTiles
        />
      );
      expect(screen.getByTestId('day-detail-tile-session')).toHaveTextContent('19:00');
      expect(screen.getByTestId('day-detail-tile-expires')).toBeInTheDocument();
    });

    it('artist: hides the Expires tile while offerExpiresAt is null (clock not started)', () => {
      render(
        <DayDetail
          role="artist"
          day={new Date(2026, 7, 20)}
          artistEntries={[artistEntry({ myStatus: 'suggested', session1: '19:00', offerExpiresAt: null })]}
          showInfoTiles
        />
      );
      expect(screen.getByTestId('day-detail-tile-session')).toBeInTheDocument();
      expect(screen.queryByTestId('day-detail-tile-expires')).not.toBeInTheDocument();
    });

    it('never renders tiles for a producer, even with showInfoTiles set', () => {
      render(
        <DayDetail
          role="producer"
          day={new Date(2026, 7, 20)}
          producerEntries={[producerEntry()]}
          showInfoTiles
        />
      );
      expect(screen.queryByTestId('day-detail-tiles')).not.toBeInTheDocument();
    });

    it('renders no tiles by default (desktop DayRail path is unaffected)', () => {
      render(
        <DayDetail
          role="artist"
          day={new Date(2026, 7, 20)}
          artistEntries={[artistEntry({ myStatus: 'suggested', offerExpiresAt: '2026-08-20T17:00:00' })]}
        />
      );
      expect(screen.queryByTestId('day-detail-tiles')).not.toBeInTheDocument();
    });
  });

  it('applies an incoming className to the root card element', () => {
    const { container } = render(
      <DayDetail role="producer" day={new Date(2026, 7, 20)} producerEntries={[]} className="mobile-sheet" />
    );
    expect(container.firstElementChild).toHaveClass('mobile-sheet');
  });
});
