import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PageMiniView } from './PageMini';
import { settingsMini } from '@/lib/minis/pages/settings';
import { settingsArt } from './illustrations/SettingsMini';
import { MINIS, PAGE_KEYS, type MiniRole } from '@/lib/minis';
import { ART } from './illustrations';

const base = {
  def: settingsMini,
  art: settingsArt,
  onHide: () => {},
  onResume: () => {},
} as const;

describe('PageMiniView', () => {
  it('renders the eyebrow and all four step labels when shown', () => {
    renderWithProviders(<PageMiniView {...base} role="admin" lang="en" dismissed={false} />);
    expect(screen.getByText('What settings decide')).toBeInTheDocument();
    expect(screen.getByText('Booking engine')).toBeInTheDocument();
    expect(screen.getByText('Casts and cities')).toBeInTheDocument();
    expect(screen.getByText('Hire orders')).toBeInTheDocument();
    expect(screen.getByText('Audit trail')).toBeInTheDocument();
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
          <PageMiniView def={def} role={role} lang={lang} art={ART[page]} dismissed={false} onHide={() => {}} onResume={() => {}} />,
        );
        expect(screen.getByText(def.eyebrow[lang])).toBeInTheDocument();
        unmount();
      }
    }
  });
});
