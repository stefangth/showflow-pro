import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/renderWithProviders';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DemoBar } from '@/components/demo/DemoBar';

// renderWithProviders supplies a DemoProvider whose currentOrg.is_demo is controllable
// via the `authOverrides` option (a test-only AuthContext.Provider mounted underneath it).
describe('DemoBadge', () => {
  it('shows DEMO inside a demo org', () => {
    render(<DemoBadge />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });

  it('renders nothing outside a demo org', () => {
    const { container } = render(<DemoBadge />, {
      authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: false } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with no active org', () => {
    const { container } = render(<DemoBadge />, { authOverrides: { currentOrg: null } });
    expect(container).toBeEmptyDOMElement();
  });
});

// DemoContext wires DemoBar's Reset button to useResetDemo() (src/hooks/useDemo.ts), which
// binds the REAL supabase singleton — a real click would attempt a network call. Mock the
// mutation hook itself (not the whole DemoContext, which is exercised for real everywhere
// else in this file) so `reset()` is observable as a plain spy without a network dependency.
const resetMutate = vi.fn();
vi.mock('@/hooks/useDemo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDemo')>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: resetMutate, isPending: false }),
  };
});

describe('DemoBar', () => {
  it('shows the demo mode indicator inside a demo org', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });
    expect(screen.getByText('Demo mode')).toBeInTheDocument();
  });

  it('renders nothing outside a demo org', () => {
    const { container } = render(<DemoBar />, {
      authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: false } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('clicking a role button switches the active viewAsRole via setViewAsRole', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });

    const producerButton = screen.getByRole('button', { name: 'Production Team' });
    expect(producerButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(producerButton);
    expect(producerButton).toHaveAttribute('aria-pressed', 'true');

    // Clicking the already-active role again clears the simulation (toggle off).
    fireEvent.click(producerButton);
    expect(producerButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('reset triggers the reset action', () => {
    resetMutate.mockClear();
    render(<DemoBar />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(resetMutate).toHaveBeenCalledTimes(1);
    expect(resetMutate).toHaveBeenCalledWith({ orgId: 'o', volume: 'full' });
  });
});
