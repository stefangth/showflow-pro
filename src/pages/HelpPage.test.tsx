import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import i18n from '@/i18n';
import { STORAGE_KEY } from '@/i18n/config';

// HelpPage only reads roles + currentOrg from auth; stub it so no AuthProvider is needed.
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ roles: ['admin'], currentOrg: { id: 'o1', name: 'Acme Shows' } }),
}));

import HelpPage from './HelpPage';

beforeEach(() => localStorage.clear());
afterEach(async () => { await i18n.changeLanguage('en'); });

describe('HelpPage', () => {
  it('renders the hero and has no "still open" control or badge', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<HelpPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What people ask, and where the app answers it');
    expect(screen.getByRole('button', { name: /^All$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New answers/ })).toBeInTheDocument();
    expect(screen.queryByText(/still open/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /still open/i })).toBeNull();
  });

  it('renders German copy when the stored language is German', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    await i18n.changeLanguage('de');
    renderWithProviders(<HelpPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Was Leute fragen, und wo die App es beantwortet');
  });

  it('toggling a question reveals its answer', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<HelpPage />);
    const q = screen.getByRole('button', { name: /What is ShowFlow, and what does it do\?/i });
    expect(screen.queryByText(/ShowFlow is where your organization plans its shows/i)).toBeNull();
    fireEvent.click(q);
    expect(screen.getByText(/ShowFlow is where your organization plans its shows/i)).toBeInTheDocument();
  });

  it('renders the role-specific escalate action and a glossary term', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<HelpPage />);
    // Default role is admin (mocked roles) -> its escalate label, via ESCALATE_KEY[role].
    expect(screen.getByRole('button', { name: 'Contact platform admin' })).toBeInTheDocument();
    // A glossary card title comes from termLabel(term, lang).
    expect(screen.getByText('Understudy')).toBeInTheDocument();
  });

  it('the New filter keeps only new-answer items', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<HelpPage />);
    // An "Answered" (ok) admin question is visible under "All"...
    expect(screen.getByRole('button', { name: /Where am I\? Is this thing empty, or broken\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New answers/ }));
    // ...and gone once we filter to new answers only.
    expect(screen.queryByRole('button', { name: /Where am I\? Is this thing empty, or broken\?/i })).toBeNull();
  });
});
