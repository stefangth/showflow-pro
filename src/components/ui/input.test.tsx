import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders with DS radius-s (6px) and a token border', () => {
    render(<Input aria-label="field" />);
    const el = screen.getByLabelText('field');
    expect(el.className).toContain('rounded-s');
    // real 1px token border: forced-colors-safe (box-shadow is ignored there) and no sub-pixel collapse
    expect(el.className).toContain('border-border');
  });
});
