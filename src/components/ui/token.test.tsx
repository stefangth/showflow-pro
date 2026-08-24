import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Token } from './token';

describe('Token', () => {
  it('renders a machine string in mono', () => {
    render(<Token>data.records:read</Token>);
    expect(screen.getByText('data.records:read').className).toContain('font-mono');
  });

  it('accepts a className without losing mono', () => {
    render(<Token className="text-muted-foreground">HO-2026-0042</Token>);
    const el = screen.getByText('HO-2026-0042');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('text-muted-foreground');
  });
});
