import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SeasonKpis } from './SeasonKpis';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';

const KPIS: SeasonKpisData = {
  unfilledMainSlots: 14,
  heaviestWeekLabel: '10/08/2026',
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
});
