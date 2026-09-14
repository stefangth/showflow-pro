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

/** Read one dotted leaf out of a catalog object. */
function leaf(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

// German may carry per-kind sibling keys that English does not need (English uses
// vocabulary variables; German grammar sometimes cannot). The only allowed shape:
//   base key present in both languages, German base value "$t(ns:path_{{kind}})",
//   and BOTH `_production` and `_staffing` siblings present in German.
const KIND_SIBLING = /^(.+)_(production|staffing)((?:_(?:one|other))?)$/;

// English is the canonical shape; German must match it key-for-key. `fallbackLng: 'en'`
// would otherwise let a missing German key silently render English in production.
describe('catalog key parity', () => {
  for (const ns of [
    'common', 'help', 'dashboard', 'bookings', 'availability',
    'settings', 'settingsDocs', 'settingsCastsCoverage', 'settingsSkills', 'settingsTrust',
    'settingsAirtable', 'settingsBookingFlow', 'settingsHireOrders', 'settingsEmailTemplates',
    'settingsRolesRights', 'settingsEditor',
    'auth', 'admin', 'artists', 'productions', 'hireOrdersPages', 'showsDetail', 'chats', 'profile',
    'onboarding', 'flowCopy', 'bookingCopy', 'getRunning', 'getRunningV3', 'today',
  ] as const) {
    it(`de matches en for namespace "${ns}"`, () => {
      const enKeys = keyset(resources.en[ns]).sort();
      const deKeys = keyset(resources.de[ns]).sort();
      const en = new Set(enKeys);
      const de = new Set(deKeys);
      expect(enKeys.filter((k) => !de.has(k)), 'English keys missing in German').toEqual([]);
      const extra = deKeys.filter((k) => !en.has(k));
      for (const key of extra) {
        const m = key.match(KIND_SIBLING);
        expect(m, `${ns}.${key}: German-only key that is not a kind sibling`).not.toBeNull();
        const [, base, kind, plural] = m!;
        const baseKey = `${base}${plural}`;
        expect(en.has(baseKey), `${ns}.${key}: base key ${baseKey} missing in English`).toBe(true);
        const twin = `${base}_${kind === 'production' ? 'staffing' : 'production'}${plural}`;
        expect(de.has(twin), `${ns}.${key}: sibling ${twin} missing`).toBe(true);
        const baseValue = leaf(resources.de[ns], baseKey);
        expect(baseValue, `${ns}.${baseKey} must nest its siblings`).toBe(`$t(${ns}:${base}_{{kind}}${plural})`);
      }
    });
  }
});
