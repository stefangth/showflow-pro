import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SeasonKpis } from './SeasonKpis';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';

const KPIS: SeasonKpisData = {
  unfilledMainSlots: 14,
  unfilledDates: 6,
  heaviestWeekLabel: '10/08/2026',
  heaviestWeekDates: 5,
  heaviestWeekOpen: 9,
  readyForHireOrder: 3,
};

describe('SeasonKpis', () => {
  it('renders 3 labeled tiles with the given values', () => {
    render(<SeasonKpis kpis={KPIS} />);

    const region = screen.getByTestId('season-kpis');
    expect(within(region).getAllByTestId(/^season-kpi-/)).toHaveLength(3);

    const unfilled = screen.getByTestId('season-kpi-unfilledMainSlots');
    expect(unfilled).toHaveTextContent('Unfilled main slots');
    expect(unfilled).toHaveTextContent('14');

    const heaviest = screen.getByTestId('season-kpi-heaviestWeek');
    expect(heaviest).toHaveTextContent('Heaviest week');
    expect(heaviest).toHaveTextContent('10/08/2026');

    const ready = screen.getByTestId('season-kpi-readyForHireOrder');
    expect(ready).toHaveTextContent('Ready for hire order');
    expect(ready).toHaveTextContent('3');
  });

  it('renders a context note under each tile derived from the kpis data', () => {
    render(<SeasonKpis kpis={KPIS} />);

    expect(screen.getByTestId('season-kpi-unfilledMainSlots')).toHaveTextContent('across 6 dates');
    expect(screen.getByTestId('season-kpi-heaviestWeek')).toHaveTextContent('5 dates · 9 slots open');
    expect(screen.getByTestId('season-kpi-readyForHireOrder')).toHaveTextContent('fully filled, no order yet');
  });

  it('singularizes the date word and copes with an empty heaviest week', () => {
    render(
      <SeasonKpis
        kpis={{ unfilledMainSlots: 2, unfilledDates: 1, heaviestWeekLabel: '', heaviestWeekDates: 0, heaviestWeekOpen: 0, readyForHireOrder: 0 }}
      />
    );
    expect(screen.getByTestId('season-kpi-unfilledMainSlots')).toHaveTextContent('across 1 date');
    // no heaviest-week label -> value dash, no note line crash
    expect(screen.getByTestId('season-kpi-heaviestWeek')).toHaveTextContent('-');
    expect(screen.getByTestId('season-kpi-readyForHireOrder')).toHaveTextContent('none waiting');
  });
});
