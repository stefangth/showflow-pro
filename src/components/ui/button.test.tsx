import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  const variants = ['default', 'secondary', 'destructive', 'ghost', 'outline', 'link'] as const;
  const sizes = ['sm', 'default', 'lg', 'icon'] as const;

  it.each(variants)('renders variant=%s without crashing', (variant) => {
    render(<Button variant={variant}>Test</Button>);
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it.each(sizes)('renders size=%s without crashing', (size) => {
    render(<Button size={size}>T</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies primary design-system class for default variant', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-primary');
  });

  it('applies correct class for secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-card');
  });

  it('applies destructive/10 bg for destructive variant', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('text-destructive');
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders as child element when asChild=true', () => {
    render(
      <Button asChild>
        <a href="/test">Link button</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Link button' })).toBeInTheDocument();
  });
});
