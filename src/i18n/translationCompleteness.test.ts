import { describe, it, expect } from 'vitest';
import { resources } from './index';

/** Flatten a nested catalog to { 'dotted.key': stringValue } leaves. */
function leaves(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      leaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

// keyParity guarantees de/en share the same keys and copyLint guards dashes +
// formal "Sie" address, but nothing checks that a German value is actually German
// rather than English left in place: tsc validates JSON shape and the whole suite
// renders in English. This catches a de string accidentally identical to its en
// counterpart (a paste-through). Values that are legitimately identical across both
// languages (proper nouns, symbol/interpolation-only strings) are allowlisted with
// the reason they match; every other identical pair fails the test.
const IDENTICAL_OK: Record<string, string> = {
  'bookings.producer.statusPlaceholder': 'proper noun "Status" is identical in German',
  'bookings.producer.sortAsc': 'interpolation + arrow only, no translatable words',
  'bookings.producer.sortDesc': 'interpolation + arrow only, no translatable words',
};

describe('German catalog is translated (not English left in place)', () => {
  for (const ns of ['bookings', 'availability'] as const) {
    it(`de differs from en for translatable keys in "${ns}"`, () => {
      const en = leaves(resources.en[ns]);
      const de = leaves(resources.de[ns]);
      const suspicious = Object.keys(en).filter(
        (k) => en[k] === de[k] && !(`${ns}.${k}` in IDENTICAL_OK),
      );
      expect(
        suspicious,
        `de value identical to en (untranslated?): ${suspicious.join(', ')}`,
      ).toEqual([]);
    });
  }
});
