import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LensTabs } from './LensTabs';

const lenses = [
  { key: 'needs-you', label: 'Needs you', count: 3 },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
];

describe('LensTabs', () => {
  it('renders each lens tab with its label and optional count badge', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the active tab distinctly from the others', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    const activeTab = screen.getByTestId('lens-tab-month');
    const inactiveTab = screen.getByTestId('lens-tab-week');
    expect(activeTab).toHaveAttribute('data-active', 'true');
    expect(inactiveTab).toHaveAttribute('data-active', 'false');
    expect(activeTab.className).not.toBe(inactiveTab.className);
  });

  it('fires onChange with the clicked lens key', () => {
    const onChange = vi.fn();
    render(<LensTabs lenses={lenses} active="month" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('lens-tab-week'));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('is a neutral recessed track — active tab uses bg-card, not a brand fill', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    const track = screen.getByRole('tablist');
    expect(track.className).toMatch(/surface-3/);
    const activeTab = screen.getByTestId('lens-tab-month');
    const inactiveTab = screen.getByTestId('lens-tab-week');
    expect(activeTab.className).toContain('bg-card');
    expect(activeTab.className).not.toMatch(/bg-primary\b/);
    expect(inactiveTab.className).toContain('text-muted-foreground');
  });

  it('renders the count badge before the label, tinted by active state', () => {
    render(<LensTabs lenses={lenses} active="needs-you" onChange={vi.fn()} />);
    const activeTab = screen.getByTestId('lens-tab-needs-you');
    const badge = screen.getByText('3');
    const label = screen.getByText('Needs you');
    // badge precedes label in DOM order
    expect(
      badge.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(activeTab.contains(badge)).toBe(true);
    expect(badge.className).toContain('bg-accent-50');
    expect(badge.className).toContain('text-accent-text');
  });

  it('tints an inactive tab count badge neutrally', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('bg-foreground/5');
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('without scrollable, keeps the default inline-flex layout', () => {
    render(<LensTabs lenses={lenses} active="month" onChange={vi.fn()} />);
    const track = screen.getByRole('tablist');
    expect(track.className).toContain('inline-flex');
    expect(track.className).not.toContain('overflow-x-auto');
    const tab = screen.getByTestId('lens-tab-month');
    expect(tab.className).not.toContain('shrink-0');
    expect(tab.className).not.toContain('snap-start');
  });

  it('with scrollable, renders a single non-wrapping horizontally-scrolling row', () => {
    const manyLenses = [
      { key: 'needs-you', label: 'Needs you', count: 3 },
      { key: 'month', label: 'Month' },
      { key: 'week', label: 'Week' },
      { key: 'day', label: 'Day' },
      { key: 'agenda', label: 'Agenda' },
    ];
    render(
      <LensTabs lenses={manyLenses} active="month" onChange={vi.fn()} scrollable />
    );
    const track = screen.getByRole('tablist');
    expect(track.className).toContain('flex');
    expect(track.className).toContain('overflow-x-auto');
    expect(track.className).not.toContain('flex-wrap');
    manyLenses.forEach(lens => {
      expect(screen.getByTestId(`lens-tab-${lens.key}`)).toBeInTheDocument();
    });
    const activeTab = screen.getByTestId('lens-tab-month');
    expect(activeTab).toHaveAttribute('data-active', 'true');
    expect(activeTab.className).toContain('shrink-0');
    expect(activeTab.className).toContain('snap-start');
  });
});
