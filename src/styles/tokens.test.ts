import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('DS canonical token foundation', () => {
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
