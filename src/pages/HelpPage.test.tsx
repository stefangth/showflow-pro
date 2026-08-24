import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '@/test/renderWithProviders';
import i18n from '@/i18n';
import { STORAGE_KEY } from '@/i18n/config';

// HelpPage only reads roles + currentOrg from auth; stub it so no AuthProvider is needed.
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ roles: ['admin'], currentOrg: { id: 'o1', name: 'Acme Shows' } }),
}));

import HelpPage from './HelpPage';

/** HelpPage reads `?item=` / `?q=` off the URL, so every render needs a router around it.
 *  `route` seeds the location the same way an in-app link would. */
function renderHelp(route = '/help') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[route]}>
      <HelpPage />
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(async () => { await i18n.changeLanguage('en'); });

describe('HelpPage', () => {
  it('renders the hero and has no "still open" control or badge', async () => {
    await i18n.changeLanguage('en');
    renderHelp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What people ask, and where the app answers it');
    expect(screen.getByRole('button', { name: /^All$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New answers/ })).toBeInTheDocument();
    expect(screen.queryByText(/still open/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /still open/i })).toBeNull();
  });

  it('renders German copy when the stored language is German', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    await i18n.changeLanguage('de');
    renderHelp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Was Leute fragen, und wo die App es beantwortet');
  });

  it('toggling a question reveals its answer', async () => {
    await i18n.changeLanguage('en');
    renderHelp();
    const q = screen.getByRole('button', { name: /What is ShowFlow, and what does it do\?/i });
    expect(screen.queryByText(/ShowFlow is where your organization plans its productions/i)).toBeNull();
    fireEvent.click(q);
    expect(screen.getByText(/ShowFlow is where your organization plans its productions/i)).toBeInTheDocument();
  });

  it('renders the "still stuck" guidance and a glossary term', async () => {
    await i18n.changeLanguage('en');
    renderHelp();
    // The "still need help" card is informational (no action buttons).
    expect(screen.getByText('STILL NEED HELP')).toBeInTheDocument();
    // A glossary card title comes from termLabel(term, lang).
    expect(screen.getByText('Understudy')).toBeInTheDocument();
  });

  it('the New filter keeps only new-answer items', async () => {
    await i18n.changeLanguage('en');
    renderHelp();
    // An "Answered" (ok) admin question is visible under "All"...
    expect(screen.getByRole('button', { name: /Where am I\? Is this thing empty, or broken\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New answers/ }));
    // ...and gone once we filter to new answers only.
    expect(screen.queryByRole('button', { name: /Where am I\? Is this thing empty, or broken\?/i })).toBeNull();
  });
});

describe('HelpPage deep links', () => {
  it('opens the answer named by ?item=', async () => {
    await i18n.changeLanguage('en');
    renderHelp('/help?item=A3.11');
    expect(screen.getByRole('button', { name: /A date has no city\. Where do I fix that\?/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('switches to the role tab that owns the item', async () => {
    await i18n.changeLanguage('en');
    renderHelp('/help?item=P3.1');
    // P-ids are production-team answers; landing on the admin tab would hide the item.
    expect(screen.getByRole('button', { name: /Where do dates come from\? Can I add one by hand\?/i })).toBeInTheDocument();
  });

  it('prefills the search box from ?q=', async () => {
    await i18n.changeLanguage('en');
    renderHelp('/help?q=letterhead');
    expect(screen.getByRole('searchbox')).toHaveValue('letterhead');
  });

  it('renders normally for an unknown ?item=', async () => {
    await i18n.changeLanguage('en');
    renderHelp('/help?item=NOPE');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
