import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Alert, AlertDescription } from './alert';

describe('Alert', () => {
  it('destructive variant uses the DS red tint pattern', () => {
    render(<Alert variant="destructive"><AlertDescription>boom</AlertDescription></Alert>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('var(--red-100)');
    expect(el.className).toContain('var(--red-600)');
  });
});
