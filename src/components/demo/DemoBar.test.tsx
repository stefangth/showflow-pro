import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/renderWithProviders';
import { DemoBadge } from '@/components/demo/DemoBadge';

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
