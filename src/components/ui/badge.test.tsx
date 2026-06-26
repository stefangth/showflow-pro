import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  const variants = ['default','secondary','destructive','outline','confirmed','hold','risk','accent','neutral'] as const;

  it.each(variants)('renders variant=%s without crashing', (variant) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('destructive uses the DS red tint pattern', () => {
    render(<Badge variant="destructive">suspended</Badge>);
    const el = screen.getByText('suspended');
    expect(el.className).toContain('var(--red-100)');
    expect(el.className).toContain('var(--red-600)');
  });

  it('confirmed uses the DS green tint, hold the amber tint', () => {
    render(<><Badge variant="confirmed">c</Badge><Badge variant="hold">h</Badge></>);
    expect(screen.getByText('c').className).toContain('var(--green-100)');
    expect(screen.getByText('c').className).toContain('var(--green-600)');
    expect(screen.getByText('h').className).toContain('var(--amber-100)');
    expect(screen.getByText('h').className).toContain('var(--amber-600)');
  });

  it('risk uses the DS amber tint pattern', () => {
    render(<Badge variant="risk">r</Badge>);
    const el = screen.getByText('r');
    expect(el.className).toContain('var(--amber-100)');
    expect(el.className).toContain('var(--amber-600)');
  });
});
