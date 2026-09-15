import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, render } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PageMiniView } from './PageMini';
import { settingsMini } from '@/lib/minis/pages/settings';
import { settingsArt } from './illustrations/SettingsMini';
import { MINIS, PAGE_KEYS, type MiniDef, type MiniRole } from '@/lib/minis';
import { ART, resolveArt } from './illustrations';
import { VOCABULARY, interpolateVocabulary } from '@/lib/orgKind';

const base = {
  def: settingsMini,
  art: settingsArt,
  onHide: () => {},
  onResume: () => {},
  vocab: VOCABULARY.production.en,
} as const;

describe('PageMiniView', () => {
  it('renders the eyebrow and all four step labels when shown', () => {
    renderWithProviders(<PageMiniView {...base} role="admin" lang="en" dismissed={false} />);
    expect(screen.getByText('What settings decide')).toBeInTheDocument();
    expect(screen.getByText('Booking engine')).toBeInTheDocument();
    expect(screen.getByText('Casts and cities')).toBeInTheDocument();
    expect(screen.getByText('Contracts')).toBeInTheDocument();
    expect(screen.getByText('Audit trail')).toBeInTheDocument();
  });

  // The illustrations render invented tiers, people and audit lines. On an org that has
  // none of them that reads as real data, so the panel has to say it is an illustration.
  it('labels the illustration as an example', () => {
    renderWithProviders(<PageMiniView {...base} role="admin" lang="en" dismissed={false} />);
    expect(screen.getByText(/example/i)).toBeInTheDocument();
  });

  it('labels the illustration as an example in German too', () => {
    renderWithProviders(<PageMiniView {...base} role="admin" lang="de" dismissed={false} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
  });

  it('calls onHide when Hide is clicked', () => {
    const onHide = vi.fn();
    renderWithProviders(<PageMiniView {...base} role="admin" lang="en" dismissed={false} onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('shows the Resume bar and calls onResume when dismissed', () => {
    const onResume = vi.fn();
    renderWithProviders(<PageMiniView {...base} role="admin" lang="en" dismissed onResume={onResume} />);
    expect(screen.queryByText('Casts and cities')).not.toBeInTheDocument();
    expect(screen.getByText('What settings decide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('renders German copy and Ausblenden when lang is de', () => {
    renderWithProviders(<PageMiniView {...base} role="admin" lang="de" dismissed={false} />);
    expect(screen.getByText('Was Einstellungen festlegen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ausblenden' })).toBeInTheDocument();
    expect(screen.getByText('Buchungs-Engine')).toBeInTheDocument();
  });

  it('renders nothing when the role has no variant', () => {
    const { container } = renderWithProviders(
      <PageMiniView {...base} role="artist" lang="en" dismissed={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // Smoke: every registered page mini renders (each variant, both languages) without
  // throwing, exercising every illustration and atom.
  it.each(PAGE_KEYS)('renders the %s mini for every variant in both languages', (page) => {
    const def = MINIS[page];
    for (const role of Object.keys(def.variants) as MiniRole[]) {
      for (const lang of ['en', 'de'] as const) {
        const { unmount } = renderWithProviders(
          <PageMiniView def={def} role={role} lang={lang} art={resolveArt(ART[page], VOCABULARY.production.en)} dismissed={false} onHide={() => {}} onResume={() => {}} vocab={VOCABULARY.production[lang]} />,
        );
        expect(screen.getByText(interpolateVocabulary(def.eyebrow[lang], VOCABULARY.production[lang]))).toBeInTheDocument();
        unmount();
      }
    }
  });

  it('substitutes vocabulary variables in step copy', () => {
    const def = { ...MINIS.artists, eyebrow: { en: 'What {{artists}} are', de: 'Was {{Artists}} sind' } } as MiniDef;
    render(<PageMiniView def={def} role="admin" lang="en" art={resolveArt(ART.artists, VOCABULARY.staffing.en)} dismissed={false} onHide={() => {}} onResume={() => {}} vocab={VOCABULARY.staffing.en} />);
    expect(screen.getByText('What people are')).toBeInTheDocument();
  });

  it('renders illustration domain nouns in the staffing vocabulary', () => {
    // The illustration factory reads the English kind vocabulary, so a staffing org's
    // decorative labels swap the workspace-type nouns (skill to qualification) while the
    // illustration stays English.
    render(<PageMiniView def={MINIS.artists} role="admin" lang="en" art={resolveArt(ART.artists, VOCABULARY.staffing.en)} dismissed={false} onHide={() => {}} onResume={() => {}} vocab={VOCABULARY.staffing.en} />);
    expect(screen.getByText('Missing a required qualification')).toBeInTheDocument();
    // Production keeps the original noun.
    render(<PageMiniView def={MINIS.artists} role="admin" lang="en" art={resolveArt(ART.artists, VOCABULARY.production.en)} dismissed={false} onHide={() => {}} onResume={() => {}} vocab={VOCABULARY.production.en} />);
    expect(screen.getByText('Missing a required skill')).toBeInTheDocument();
  });
});
