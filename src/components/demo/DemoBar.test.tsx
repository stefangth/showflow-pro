import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { render, screen } from '@/test/renderWithProviders';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DemoBar } from '@/components/demo/DemoBar';
import { DemoOutbox } from '@/components/demo/DemoOutbox';
import type { CapturedSend } from '@/data/demo';
import { formatTimestampLocal } from '@/lib/dates';

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
// Same rationale extends to `useDemoState`/`useUpdateDemoState`: the scene selector and sim
// clock read `demoState` (current_scene_id/sim_now) and write through `useUpdateDemoState`'s
// mutate — mocking just those two hooks keeps DemoContext itself real (goToScene/advanceClock
// run for real, computing the patch) while stubbing out the network-bound query/mutation.
const resetMutate = vi.fn();
const updateDemoStateMutate = vi.fn();
let capturedSends: CapturedSend[] = [];
let demoStateData: { current_scene_id: string | null; sim_now: string | null } | undefined;
vi.mock('@/hooks/useDemo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDemo')>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: resetMutate, isPending: false }),
    useCapturedSends: () => ({ data: capturedSends, isLoading: false }),
    useDemoState: () => ({ data: demoStateData }),
    useUpdateDemoState: () => ({ mutate: updateDemoStateMutate, isPending: false }),
  };
});

const DEMO_ORG = { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } as const;

describe('DemoBar', () => {
  beforeEach(() => {
    demoStateData = undefined;
    updateDemoStateMutate.mockClear();
  });

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

  it('picking a scene from the selector calls goToScene with that scene id', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('combobox', { name: 'Scene' }));
    fireEvent.click(screen.getByRole('option', { name: /build a routing for hamlet/i }));

    expect(updateDemoStateMutate).toHaveBeenCalledWith({
      orgId: 'o',
      patch: { current_scene_id: 'build-routing' },
    });
  });

  it('clicking +10m advances the sim clock', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('button', { name: '+10m' }));

    expect(updateDemoStateMutate).toHaveBeenCalledWith({
      orgId: 'o',
      patch: { sim_now: expect.any(String) },
    });
  });

  it('displays the current sim clock value', () => {
    demoStateData = { current_scene_id: null, sim_now: '2026-08-17T17:00:00.000Z' };
    render(<DemoBar />, { authOverrides: { currentOrg: DEMO_ORG } });

    expect(screen.getByText(formatTimestampLocal('2026-08-17T17:00:00.000Z'))).toBeInTheDocument();
  });

  it('shows a dash-like placeholder when the sim clock has not been touched', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: DEMO_ORG } });

    expect(screen.getByText('now')).toBeInTheDocument();
  });

  it('hide button calls hideBar and unmounts the bar', () => {
    render(<DemoBar />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('button', { name: /hide demo bar/i }));

    expect(screen.queryByText('Demo mode')).not.toBeInTheDocument();
  });

  it('exit button clears the view-as role and hides the bar', () => {
    const setViewAsRole = vi.fn();
    const setViewAsUser = vi.fn();
    render(<DemoBar />, {
      authOverrides: { currentOrg: DEMO_ORG, viewAsRole: 'producer', setViewAsRole, setViewAsUser },
    });

    fireEvent.click(screen.getByRole('button', { name: /exit demo view/i }));

    expect(setViewAsRole).toHaveBeenCalledWith(null);
    expect(setViewAsUser).toHaveBeenCalledWith(null);
    expect(screen.queryByText('Demo mode')).not.toBeInTheDocument();
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
