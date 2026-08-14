import { describe, it, expect } from 'vitest';
import { resources } from './index';

/** Flatten a nested catalog object to a sorted list of dotted key paths. */
function keyset(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      keyset(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

// English is the canonical shape; German must match it key-for-key. `fallbackLng: 'en'`
// would otherwise let a missing German key silently render English in production.
describe('catalog key parity', () => {
  for (const ns of ['common', 'help', 'dashboard'] as const) {
    it(`de matches en for namespace "${ns}"`, () => {
      const en = keyset(resources.en[ns]).sort();
      const de = keyset(resources.de[ns]).sort();
      expect(de).toEqual(en);
    });
  }
});
