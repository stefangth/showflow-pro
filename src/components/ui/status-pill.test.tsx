import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusPill } from './status-pill';
import { StatusDot } from './status-dot';
import { TONES } from './tones';

describe('TONES', () => {
  it('keeps waiting amber and risk red as distinct tones (D3)', () => {
    expect(TONES.waiting.bg).toContain('--amber-100');
    expect(TONES.risk.bg).toContain('--red-100');
    expect(TONES.waiting.bg).not.toEqual(TONES.risk.bg);
  });
});

describe('StatusPill', () => {
  it('applies the tone background and foreground classes', () => {
    const { container } = render(<StatusPill tone="risk">At risk</StatusPill>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-[var(--red-100)]');
    expect(el.className).toContain('text-[var(--red-600)]');
  });

  it('renders a dot only when asked', () => {
    const { container: without } = render(<StatusPill tone="confirmed">Confirmed</StatusPill>);
    const { container: with_ } = render(<StatusPill tone="confirmed" dot>Confirmed</StatusPill>);
    expect(without.querySelectorAll('span[aria-hidden="true"]').length).toBe(0);
    expect(with_.querySelectorAll('span[aria-hidden="true"]').length).toBe(1);
  });
});

describe('StatusDot', () => {
  it('is a square (rounded-[2px]), not a circle', () => {
    const { container } = render(<StatusDot tone="neutral" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('rounded-[2px]');
    expect(el.className).not.toContain('rounded-full');
  });
});
