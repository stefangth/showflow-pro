import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders with DS radius-s (6px) and a hairline border', () => {
    render(<Input aria-label="field" />);
    const el = screen.getByLabelText('field');
    expect(el.className).toContain('rounded-[6px]');
    expect(el.className).toContain('border-[0.5px]');
  });
});
