import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Metric } from './metric';

describe('Metric', () => {
  it('renders tabular figures without switching to mono', () => {
    render(<Metric>1240</Metric>);
    const el = screen.getByText('1240');
    expect(el.className).toContain('tabular-nums');
    expect(el.className).not.toContain('font-mono');
  });

  it('keeps tabular figures at every size', () => {
    for (const size of ['inline', 'body', 'lg'] as const) {
      const { unmount } = render(<Metric size={size}>{size}</Metric>);
      const el = screen.getByText(size);
      expect(el.className).toContain('tabular-nums');
      expect(el.className).not.toContain('font-mono');
      unmount();
    }
  });
});
