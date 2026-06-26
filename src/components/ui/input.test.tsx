import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders with DS radius-s (6px) and a hairline border', () => {
    render(<Input aria-label="field" />);
    const el = screen.getByLabelText('field');
    expect(el.className).toContain('rounded-[6px]');
    // hairline rendered via inset box-shadow (reliable sub-pixel at all densities)
    expect(el.className).toContain('inset_0_0_0_0.5px');
  });
});
