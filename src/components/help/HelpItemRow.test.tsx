import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HelpItemRow } from './HelpItemRow';
import type { HelpItem } from '@/lib/help/items';

const item: HelpItem = {
  id: 'T0.1',
  role: 'admin',
  stage: 0,
  status: 'ok',
  surface: 'Test surface',
  updated: '2026-09-14',
  q: { en: 'How do I add one {{artist}}?', de: 'Wie füge ich einen {{Artist}} hinzu?' },
  a: { en: 'Answer.', de: 'Antwort.' },
};

describe('HelpItemRow', () => {
  it('substitutes vocabulary variables in the question for a staffing org', () => {
    renderWithProviders(<HelpItemRow item={item} lang="en" open={false} onToggle={() => {}} />, {
      authOverrides: {
        currentOrg: { id: 'o1', name: 'A', slug: 'a', status: 'active', is_demo: false, org_kind: 'staffing', org_kind_set_at: null },
      },
    });
    expect(screen.getByText('How do I add one staff member?')).toBeInTheDocument();
  });
});
