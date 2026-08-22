import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarDaySheet } from './CalendarDaySheet';
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
    acceptedMain: 2,
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
    myStatus: 'suggested',
    hireOrderId: null,
    ...overrides,
  };
}

describe('CalendarDaySheet', () => {
  it('producer: open with a day shows DayDetail primary and an "Open date" button firing onOpenDate', () => {
    const onOpenDate = vi.fn();
    render(
      <CalendarDaySheet
        open
        onOpenChange={() => {}}
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
        onOpenDate={onOpenDate}
      />
    );

    const sheet = screen.getByTestId('calendar-day-sheet');
    expect(sheet).toBeInTheDocument();
    expect(screen.getByTestId('day-rail-primary')).toHaveTextContent('Book who said yes');

    // Exactly one grab handle (vaul's own — DrawerContent renders it via a
    // hardcoded `rounded-full bg-muted` div; CalendarDaySheet must not add
    // a second one of its own).
    expect(sheet.querySelectorAll('.rounded-full.bg-muted')).toHaveLength(1);

    // Exactly one "Open date" control — DayDetail's own secondary button
    // (which defaults to the same label) must be suppressed, not stacked
    // alongside the sheet's dedicated button.
    expect(screen.getAllByText('Open date')).toHaveLength(1);
    expect(screen.queryByTestId('day-rail-secondary')).not.toBeInTheDocument();

    const openDateBtn = screen.getByTestId('day-sheet-open-date');
    expect(openDateBtn).toHaveTextContent('Open date');
    fireEvent.click(openDateBtn);
    expect(onOpenDate).toHaveBeenCalledTimes(1);

    // Producer variant never shows the artist-only "Message producer" button.
    expect(screen.queryByTestId('day-sheet-message-producer')).not.toBeInTheDocument();
    expect(screen.queryByText('Message your production team')).not.toBeInTheDocument();
  });

  it('artist: shows "Message producer" button firing onMessageProducer', () => {
    const onMessageProducer = vi.fn();
    render(
      <CalendarDaySheet
        open
        onOpenChange={() => {}}
        role="artist"
        day={new Date(2026, 7, 20)}
        artistEntries={[artistEntry()]}
        onMessageProducer={onMessageProducer}
      />
    );

    expect(screen.getByTestId('day-rail-primary')).toHaveTextContent('Answer the ask');

    // DayDetail's own secondary button (default label "Message producer")
    // must be suppressed — only the sheet's own button renders.
    expect(screen.queryByTestId('day-rail-secondary')).not.toBeInTheDocument();
    expect(screen.getAllByText('Message your production team')).toHaveLength(1);

    const messageBtn = screen.getByTestId('day-sheet-message-producer');
    expect(messageBtn).toHaveTextContent('Message your production team');
    fireEvent.click(messageBtn);
    expect(onMessageProducer).toHaveBeenCalledTimes(1);

    // "Open date" is present for both roles, exactly once.
    expect(screen.getByTestId('day-sheet-open-date')).toBeInTheDocument();
    expect(screen.getAllByText('Open date')).toHaveLength(1);
  });

  it('dismisses via the native vaul escape path, firing onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <CalendarDaySheet
        open
        onOpenChange={onOpenChange}
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
      />
    );

    expect(screen.getByTestId('calendar-day-sheet')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when day is null', () => {
    render(
      <CalendarDaySheet open onOpenChange={() => {}} role="producer" day={null} producerEntries={[producerEntry()]} />
    );
    expect(screen.queryByTestId('calendar-day-sheet')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <CalendarDaySheet
        open={false}
        onOpenChange={() => {}}
        role="producer"
        day={new Date(2026, 7, 20)}
        producerEntries={[producerEntry()]}
      />
    );
    expect(screen.queryByTestId('calendar-day-sheet')).not.toBeInTheDocument();
  });
});
