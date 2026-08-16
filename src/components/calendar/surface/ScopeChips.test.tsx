import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopeChips } from './ScopeChips';
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

describe('ScopeChips', () => {
  it('renders an "All" chip plus one chip per non-empty group, each with its live count, and omits zero-count groups', () => {
    render(<ScopeChips queue={makeQueue()} active="all" onChange={vi.fn()} />);

    expect(screen.getByTestId('scope-chip-all')).toHaveTextContent('3');
    expect(screen.getByTestId('scope-chip-expires-today')).toHaveTextContent('1');
    expect(screen.getByTestId('scope-chip-at-risk')).toHaveTextContent('2');
    // ready-to-issue and cancelled are both zero-count in this queue.
    expect(screen.queryByTestId('scope-chip-ready-to-issue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scope-chip-cancelled')).not.toBeInTheDocument();
  });

  it('marks the active chip pressed and fires onChange with the clicked scope key', () => {
    const onChange = vi.fn();
    render(<ScopeChips queue={makeQueue()} active="at-risk" onChange={onChange} />);

    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('scope-chip-at-risk')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('scope-chip-expires-today'));
    expect(onChange).toHaveBeenCalledWith('expires-today');

    fireEvent.click(screen.getByTestId('scope-chip-all'));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
