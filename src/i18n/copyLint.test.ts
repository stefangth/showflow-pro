import { describe, it, expect } from 'vitest';
import { resources } from './index';
import { TERMS } from './terms';
import { HELP_ITEMS } from '@/lib/help/items';
import { STAGES } from '@/lib/help/stages';
import { GLOSSARY } from '@/lib/help/glossary';
import { MINIS, PAGE_KEYS } from '@/lib/minis';
import type { Lang } from './config';

const DASH = /[—–]/; // em dash, en dash

// Formal "Sie"-address, detected mid-sentence only: a formal pronoun preceded by a
// lowercase word or comma. This ignores a sentence-initial "Sie"/"Ihr" that merely
// means "it/they/her", which is legitimate in Du-form copy.
const FORMAL = /[a-zäöüß,]\s+(Sie|Ihre|Ihren|Ihrem|Ihnen|Ihr)\b/;

function strings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj && typeof obj === 'object') return Object.values(obj as Record<string, unknown>).flatMap(strings);
  return [];
}

// Every string in the page-minis data module for one language.
function miniStrings(lang: Lang): string[] {
  return PAGE_KEYS.flatMap((key) => {
    const def = MINIS[key];
    const out = [def.eyebrow[lang]];
    if (def.subnote) out.push(def.subnote[lang]);
    for (const steps of Object.values(def.variants))
      for (const step of steps!) out.push(step.label[lang], step.text[lang]);
    return out;
  });
}

const enContent = [
  ...strings(resources.en),
  ...HELP_ITEMS.flatMap((i) => [i.q.en, i.a.en]),
  ...STAGES.flatMap((s) => [s.title.en, s.moment.en]),
  ...GLOSSARY.map((g) => g.def.en),
  ...Object.values(TERMS).map((t) => t.en),
  ...miniStrings('en'),
];
const deContent = [
  ...strings(resources.de),
  ...HELP_ITEMS.flatMap((i) => [i.q.de, i.a.de]),
  ...STAGES.flatMap((s) => [s.title.de, s.moment.de]),
  ...GLOSSARY.map((g) => g.def.de),
  ...Object.values(TERMS).map((t) => t.de),
  ...miniStrings('de'),
];

describe('copy lint', () => {
  it('no em/en dashes anywhere', () => {
    for (const s of [...enContent, ...deContent]) expect(DASH.test(s), s).toBe(false);
  });

  it('German copy avoids formal "Sie" address', () => {
    for (const s of deContent) expect(FORMAL.test(s), s).toBe(false);
  });
});
