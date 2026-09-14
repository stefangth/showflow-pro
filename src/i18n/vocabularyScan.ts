import { resources } from "@/i18n";
import { HELP_ITEMS } from "@/lib/help/items";
import { GLOSSARY } from "@/lib/help/glossary";
import { MINIS, PAGE_KEYS } from "@/lib/minis";
import { VOCABULARY } from "@/lib/orgKind";

export interface VocabHit { path: string; text: string; count: number }

/** Bare domain nouns that must be vocabulary variables. Case-insensitive.
 *  "contract(s)" is in here because it is the production value of `{{hireOrder}}`: a staffing
 *  org must read "work order", so a literal "contract" in copy is a missed substitution. */
export const NOUN = /\b(shows?|artists?|productions?|casts?|understud(?:y|ies)|hire orders?|contracts?|skills?)\b/gi;

// Removed before counting: the brand, interpolation variables, and nested-key references.
const IGNORE = [/ShowFlow/g, /\{\{[^}]*\}\}/g, /\$t\([^)]*\)/g];

function walk(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
}

/** Every English string a user can read that is authored in this repo's copy modules. */
export function englishSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [ns, tree] of Object.entries(resources.en)) walk(tree, ns, out);
  for (const item of HELP_ITEMS) { out.push([`help-items.${item.id}.q`, item.q.en]); out.push([`help-items.${item.id}.a`, item.a.en]); }
  for (const g of GLOSSARY) out.push([`help-glossary.${g.term}`, g.def.en]);
  for (const page of PAGE_KEYS) {
    const def = MINIS[page];
    out.push([`minis.${page}.eyebrow`, def.eyebrow.en]);
    if (def.subnote) out.push([`minis.${page}.subnote`, def.subnote.en]);
    for (const [role, steps] of Object.entries(def.variants)) steps?.forEach((s, i) => {
      out.push([`minis.${page}.${role}[${i}].label`, s.label.en]);
      out.push([`minis.${page}.${role}[${i}].text`, s.text.en]);
    });
  }
  return out;
}

export function scanBareNouns(sources: Array<[string, string]>, skipPaths: readonly string[]): VocabHit[] {
  const hits: VocabHit[] = [];
  for (const [path, text] of sources) {
    if (skipPaths.some((p) => path.startsWith(p))) continue;
    let cleaned = text;
    for (const re of IGNORE) cleaned = cleaned.replace(re, "");
    const count = (cleaned.match(NOUN) ?? []).length;
    if (count > 0) hits.push({ path, text, count });
  }
  return hits;
}

const VOCAB_KEYS = new Set(Object.keys(VOCABULARY.production.en));

/** Every {{Token}} with an uppercase initial that is not a vocabulary key (a typo like {{Shows }} or {{Artsts}}). */
export function capitalisedTokens(sources: Array<[string, string]>): Array<[string, string]> {
  const bad: Array<[string, string]> = [];
  for (const [path, text] of sources) for (const m of text.matchAll(/\{\{([A-Z]\w*)\}\}/g)) if (!VOCAB_KEYS.has(m[1])) bad.push([path, m[1]]);
  return bad;
}
