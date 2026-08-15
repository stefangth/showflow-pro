import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FillMeter } from './FillMeter';
import type { MeterSegment } from '@/lib/calendar/types';

const segments: MeterSegment[] = [
  { filled: true },
  { filled: true },
  { filled: true },
  { filled: true },
  { filled: false },
  { filled: false },
];

describe('FillMeter', () => {
  it('renders one bar per segment, tinted by tone, filled count reflected', () => {
    render(<FillMeter segments={segments} tone="warning" />);
    const meter = screen.getByTestId('fill-meter');
    const bars = screen.getAllByTestId('fill-meter-segment');
    expect(bars).toHaveLength(6);
    expect(meter).toHaveAttribute('data-filled', '4');
    expect(meter).toHaveAttribute('data-total', '6');

    const filledBars = bars.filter(b => b.getAttribute('data-filled') === 'true');
    const emptyBars = bars.filter(b => b.getAttribute('data-filled') === 'false');
    expect(filledBars).toHaveLength(4);
    expect(emptyBars).toHaveLength(2);
    filledBars.forEach(b => expect(b.className).toContain('bg-warning'));
    emptyBars.forEach(b => expect(b.className).toContain('bg-foreground/10'));
  });

  it('renders an optional mono label', () => {
    render(<FillMeter segments={segments} tone="success" label="4/6" />);
    expect(screen.getByText('4/6')).toBeInTheDocument();
  });

  it('renders nothing hex/rgb — semantic tokens only', () => {
    render(<FillMeter segments={segments} tone="destructive" />);
    const bars = screen.getAllByTestId('fill-meter-segment');
    bars.forEach(b => expect(b.className).not.toMatch(/#|rgb/));
  });

  it('defaults to the wider "row" bar size', () => {
    render(<FillMeter segments={segments} tone="success" />);
    const meter = screen.getByTestId('fill-meter');
    expect(meter).toHaveAttribute('data-size', 'row');
    const bars = screen.getAllByTestId('fill-meter-segment');
    expect(bars[0].className).toContain('w-3.5');
  });

  it('renders narrower "chip" ticks when size="chip" (for month-grid chips)', () => {
    render(<FillMeter segments={segments} tone="success" size="chip" />);
    const meter = screen.getByTestId('fill-meter');
    expect(meter).toHaveAttribute('data-size', 'chip');
    const bars = screen.getAllByTestId('fill-meter-segment');
    expect(bars[0].className).toContain('w-1');
    expect(bars[0].className).not.toContain('w-1.5'); // guard against substring false-positive
  });
});
