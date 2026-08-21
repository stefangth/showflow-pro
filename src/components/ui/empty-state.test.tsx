import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the block action button and fires onClick', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No orders yet" body="Draft one to get going." action={{ label: 'New order', onClick }} />);
    const btn = screen.getByRole('button', { name: 'New order' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders an inline action as a text button', () => {
    const onClick = vi.fn();
    render(<EmptyState size="inline" title="Nothing here" action={{ label: 'Add one', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders with a reason and no action', () => {
    render(<EmptyState title="Locked" reason="This module is off for your org." />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
