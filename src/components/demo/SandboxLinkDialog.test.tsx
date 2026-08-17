import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/renderWithProviders';
import { SandboxLinkDialog } from '@/components/demo/SandboxLinkDialog';
import type { SandboxLink } from '@/data/demo';

// SandboxLinkDialog binds the real supabase-backed hooks (useSandboxLinks,
// useCreateSandboxLink, useRevokeSandboxLink) from src/hooks/useDemo.ts. Mock just
// those (not the whole module) so a click never attempts a real network call, same
// pattern as DemoBar.test.tsx's reset/outbox mocks.
const createMutate = vi.fn();
const revokeMutate = vi.fn();
let sandboxLinks: SandboxLink[] = [];

vi.mock('@/hooks/useDemo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDemo')>();
  return {
    ...actual,
    // DemoProvider (mounted by renderWithProviders with an is_demo org) calls
    // useDemoState on mount; stub it so no real fetchDemoState network call fires,
    // same as DemoBar.test.tsx / RunOfShowRail.test.tsx.
    useDemoState: () => ({ data: undefined }),
    useSandboxLinks: () => ({ data: sandboxLinks, isLoading: false }),
    useCreateSandboxLink: () => ({ mutate: createMutate, isPending: false }),
    useRevokeSandboxLink: () => ({ mutate: revokeMutate, isPending: false }),
  };
});

const DEMO_ORG = { id: 'o1', name: 'n', slug: 's', status: 'active', is_demo: true } as const;

describe('SandboxLinkDialog', () => {
  beforeEach(() => {
    createMutate.mockClear();
    revokeMutate.mockClear();
    sandboxLinks = [];
  });

  it('renders a "Sandbox link" trigger button', () => {
    render(<SandboxLinkDialog />, { authOverrides: { currentOrg: DEMO_ORG } });
    expect(screen.getByRole('button', { name: /sandbox link/i })).toBeInTheDocument();
  });

  it('clicking Create link calls the create mutation and shows the resulting URL', async () => {
    // Simulate the mutation firing its onSuccess callback synchronously, the way
    // react-query does for a resolved mutateAsync-free mutate() call in tests.
    createMutate.mockImplementation((_orgId: string, opts?: { onSuccess?: (data: { token: string; expires_at: string }) => void }) => {
      opts?.onSuccess?.({ token: 'tok12345', expires_at: '2026-08-30T00:00:00.000Z' });
    });

    render(<SandboxLinkDialog />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('button', { name: /sandbox link/i }));

    const createButton = await screen.findByRole('button', { name: /create link/i });
    fireEvent.click(createButton);

    expect(createMutate).toHaveBeenCalledWith('o1', expect.any(Object));

    expect(await screen.findByText(/\/sandbox\/tok12345/)).toBeInTheDocument();
  });

  it('an existing active link renders with a Revoke control that calls the revoke mutation', async () => {
    sandboxLinks = [
      {
        id: 'l1',
        org_id: 'o1',
        token: 'activeToken1',
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        created_by: 'u1',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ];

    render(<SandboxLinkDialog />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('button', { name: /sandbox link/i }));

    const revokeButton = await screen.findByRole('button', { name: /revoke/i });
    fireEvent.click(revokeButton);

    expect(revokeMutate).toHaveBeenCalledWith({ orgId: 'o1', token: 'activeToken1' });
  });

  it('an expired link shows a muted status badge instead of a Revoke control', async () => {
    sandboxLinks = [
      {
        id: 'l2',
        org_id: 'o1',
        token: 'oldToken1',
        expires_at: '2020-01-01T00:00:00.000Z',
        revoked_at: null,
        created_by: 'u1',
        created_at: '2019-12-01T00:00:00.000Z',
      },
    ];

    render(<SandboxLinkDialog />, { authOverrides: { currentOrg: DEMO_ORG } });

    fireEvent.click(screen.getByRole('button', { name: /sandbox link/i }));

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
  });
});
