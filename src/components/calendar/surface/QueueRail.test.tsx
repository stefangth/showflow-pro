import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueueRail } from './QueueRail';
import type { NeedsYouQueue } from '@/lib/calendar/needsYou';

function makeQueue(overrides: Partial<NeedsYouQueue> = {}): NeedsYouQueue {
  return {
    groups: [],
    totalItems: 3,
    countByGroup: {
      'expires-today': 1,
      'at-risk': 2,
      'ready-to-issue': 0,
      cancelled: 0,
    },
    ...overrides,
  };
}

describe('QueueRail', () => {
  it('shows the "clear the queue" breakdown from countByGroup, skipping zero-count groups', () => {
    render(<QueueRail queue={makeQueue()} clearedToday={4} shortlist={null} />);

    expect(screen.getByTestId('queue-rail-progress')).toBeInTheDocument();
    expect(screen.getByText('4 cleared today')).toBeInTheDocument();
    expect(screen.getByText('Book today')).toBeInTheDocument();
    expect(screen.getByText('At risk · short of people inside 30 days')).toBeInTheDocument();
    // Zero-count groups are omitted from the breakdown.
    expect(screen.queryByText('Ready to issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled · needs a decision')).not.toBeInTheDocument();
  });

  it('renders an eligible-artist shortlist row per artist and fires onOffer with the date + artist ids', () => {
    const onOffer = vi.fn();
    render(
      <QueueRail
        queue={makeQueue()}
        clearedToday={0}
        shortlist={{
          dateId: 'd-1',
          dateLabel: 'Thu 20 Aug · Cirque Noir',
          artists: [
            { artistId: 'a-1', name: 'Jo Reyes' },
            { artistId: 'a-2', name: 'Mika Sol' },
          ],
        }}
        onOffer={onOffer}
      />
    );

    expect(screen.getByText('Thu 20 Aug · Cirque Noir')).toBeInTheDocument();
    expect(screen.getByText('Jo Reyes')).toBeInTheDocument();
    expect(screen.getByText('Mika Sol')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('queue-offer-a-1'));
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(onOffer).toHaveBeenCalledWith('d-1', 'a-1');
  });

  it('renders nothing for the shortlist card when shortlist is null, but keeps the other cards', () => {
    render(<QueueRail queue={makeQueue()} clearedToday={0} shortlist={null} />);

    expect(screen.queryByTestId('queue-rail-shortlist')).not.toBeInTheDocument();
    expect(screen.getByTestId('queue-rail-progress')).toBeInTheDocument();
    expect(screen.getByTestId('queue-rail-rules')).toBeInTheDocument();
    expect(screen.getByText('What lands here')).toBeInTheDocument();
  });

  it('renders a rules card explaining what lands in the queue', () => {
    render(<QueueRail queue={makeQueue()} clearedToday={0} shortlist={null} />);
    const rules = screen.getByTestId('queue-rail-rules');
    expect(rules).toHaveTextContent("Asks with today's answer-by deadline");
    expect(rules).toHaveTextContent('date short of people inside 30 days');
    expect(rules).toHaveTextContent('ready for its contract');
    expect(rules).toHaveTextContent('Cancelled dates');
  });

  it('shows a fully-cleared queue at 100% when there is nothing left and nothing cleared', () => {
    render(
      <QueueRail
        queue={makeQueue({ totalItems: 0, countByGroup: { 'expires-today': 0, 'at-risk': 0, 'ready-to-issue': 0, cancelled: 0 } })}
        clearedToday={0}
        shortlist={null}
      />
    );
    expect(screen.getByTestId('queue-rail-progress-bar')).toHaveStyle({ width: '100%' });
  });
});
