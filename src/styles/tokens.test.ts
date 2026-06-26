import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const tw = readFileSync(resolve(process.cwd(), 'tailwind.config.ts'), 'utf8');

describe('DS canonical token source presence (string-match only)', () => {
  it('defines neutral aliases', () => {
    for (const t of ['--bg:', '--surface:', '--surface-2:', '--surface-3:', '--text:', '--text-muted:', '--text-faint:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });

  it('defines the primitive scales', () => {
    for (const t of ['--radius-l:', '--radius-xs:', '--space-6:', '--ease-out:', '--dur-fast:', '--row-h:', '--btn-h:', '--veil:', '--shadow-4:', '--shadow-inset:', '--primary-hover:', '--primary-active:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });

  it('defines the semantic tint tokens', () => {
    for (const t of ['--red-100:', '--red-600:', '--green-100:', '--green-600:', '--amber-100:', '--amber-600:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });
});

describe('accent scale hex conversion (source format check)', () => {
  it('accent stops are hex, not HSL triplets', () => {
    expect(css).toMatch(/--accent-500:\s*#6E5CF6/i);
    expect(css).not.toMatch(/--accent-500:\s*\d+\s+\d+%\s+\d+%/);
  });

  it('tailwind consumes the accent scale as raw var(), not hsl()', () => {
    expect(tw).not.toMatch(/hsl\(var\(--accent-\d/);
    expect(tw).toMatch(/var\(--accent-500\)/);
  });

  it('accent scale stops are hex and identical across :root and .dark', () => {
    const stops = ['50','100','200','300','400','500','600','700','800','900'];
    for (const s of stops) {
      const vals = [...css.matchAll(new RegExp(`--accent-${s}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1]);
      expect(vals.length, `--accent-${s} should be a 6-digit hex in both :root and .dark`).toBe(2);
      expect(vals[0]).toBe(vals[1]);
    }
  });
});
