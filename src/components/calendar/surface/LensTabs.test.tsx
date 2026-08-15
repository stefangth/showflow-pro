import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LensTabs } from './LensTabs';

const lenses = [
  { key: 'needs-you', label: 'Needs you', count: 3 },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
];

describe('LensTabs', () => {
  it('renders each lens tab with its label and optional count badge', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the active tab distinctly from the others', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    const activeTab = screen.getByTestId('lens-tab-month');
    const inactiveTab = screen.getByTestId('lens-tab-week');
    expect(activeTab).toHaveAttribute('data-active', 'true');
    expect(inactiveTab).toHaveAttribute('data-active', 'false');
    expect(activeTab.className).not.toBe(inactiveTab.className);
  });

  it('fires onChange with the clicked lens key', () => {
    const onChange = vi.fn();
    render(<LensTabs lenses={lenses} active="month" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('lens-tab-week'));
    expect(onChange).toHaveBeenCalledWith('week');
  });
});
