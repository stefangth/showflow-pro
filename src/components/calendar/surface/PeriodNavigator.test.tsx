import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PeriodNavigator } from './PeriodNavigator';

describe('PeriodNavigator', () => {
  it('renders the period label', () => {
    render(<PeriodNavigator label="August 2026" onPrev={vi.fn()} onNext={vi.fn()} onToday={vi.fn()} />);
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  it('fires onPrev, onNext, onToday from their respective controls', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onToday = vi.fn();
    render(<PeriodNavigator label="August 2026" onPrev={onPrev} onNext={onNext} onToday={onToday} />);

    fireEvent.click(screen.getByTestId('period-navigator-prev'));
    fireEvent.click(screen.getByTestId('period-navigator-next'));
    fireEvent.click(screen.getByTestId('period-navigator-today'));

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });
});
