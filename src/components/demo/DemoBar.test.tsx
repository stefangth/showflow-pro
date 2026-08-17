import { describe, it, expect, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { render, screen } from '@/test/renderWithProviders';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DemoBar } from '@/components/demo/DemoBar';
import { DemoOutbox } from '@/components/demo/DemoOutbox';
import type { CapturedSend } from '@/data/demo';

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
// useCapturedSends binds the same real singleton for DemoOutbox, so it is mocked the same
// way — seeded rows come from `capturedSends`, mutated per-test.
const resetMutate = vi.fn();
let capturedSends: CapturedSend[] = [];
vi.mock('@/hooks/useDemo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDemo')>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: resetMutate, isPending: false }),
    useCapturedSends: () => ({ data: capturedSends, isLoading: false }),
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

  it('renders nothing for a non-admin member of a demo org', () => {
    // The role switcher flips effectiveHasRole client-side, so a non-admin must not
    // see the bar and grant themselves an admin view (gated on the real role).
    const { container } = render(<DemoBar />, {
      authOverrides: { roles: ['producer'], currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } },
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

  it('reset triggers the reset action only after confirming', () => {
    resetMutate.mockClear();
    render(<DemoBar />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });

    // The bar's Reset button opens a confirmation dialog; nothing fires yet.
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(resetMutate).not.toHaveBeenCalled();

    // Confirming in the dialog runs the reset.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));

    expect(resetMutate).toHaveBeenCalledTimes(1);
    expect(resetMutate).toHaveBeenCalledWith({ orgId: 'o', volume: 'full' }, expect.any(Object));
  });
});

describe('DemoOutbox', () => {
  it('lists captured sends after opening the dialog', async () => {
    capturedSends = [
      {
        id: 'c1',
        org_id: 'o1',
        kind: 'email',
        to_label: 'a@demo.invalid',
        subject: 'Offer sent',
        preview_html: null,
        storage_path: null,
        created_at: '2026-08-16T00:00:00.000Z',
      },
    ];
    render(<DemoOutbox />, {
      authOverrides: { currentOrg: { id: 'o1', name: 'n', slug: 's', status: 'active', is_demo: true } },
    });

    fireEvent.click(screen.getByRole('button', { name: /outbox/i }));

    expect(await screen.findByText('Offer sent')).toBeInTheDocument();
  });

  it('shows the empty state with no captured sends', () => {
    capturedSends = [];
    render(<DemoOutbox />, {
      authOverrides: { currentOrg: { id: 'o1', name: 'n', slug: 's', status: 'active', is_demo: true } },
    });

    fireEvent.click(screen.getByRole('button', { name: /outbox/i }));

    expect(screen.getByText(/nothing sent yet/i)).toBeInTheDocument();
  });
});
