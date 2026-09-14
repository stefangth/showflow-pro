# Workspace type (org_kind), PR 2: copy audit. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user-facing sentence in the client copy (30 locale namespaces, the Help center items and glossary, the page minis) names its domain nouns through the `{{vocabulary}}` variables PR 1 installed, in English and German, so a staffing org reads "clients, shifts, people, teams" everywhere while every production org renders byte-identically to today. The noun scanner goes from a ratchet to a zero-with-allowlist gate.

**Architecture:** PR 1 already feeds `VOCABULARY[kind][lang]` into i18next as `interpolation.defaultVariables` (`VocabularyBridge`). This PR (1) extends the registry with `roleProducer`, a `kind` variable and a pure `interpolateVocabulary()` helper, (2) renames the four runtime interpolation variables whose names collide with vocabulary keys, (3) makes `termLabel` and `roleLabel` kind-aware, (4) substitutes vocabulary at render time in the three TypeScript copy modules that bypass i18next (Help items, glossary, minis), (5) rewrites the locale files namespace by namespace, and (6) turns the scanner into a gate. German sentences whose grammar cannot take a bare variable get per-kind sibling keys selected by i18next nesting, `"$t(ns:path.key_{{kind}})"`, which resolves through the same default variables with no call-site changes.

**Tech Stack:** React 18, TypeScript, i18next 23 / react-i18next 15, Vitest, Playwright. No schema, edge, or migration changes.

**Spec:** `docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md`, R4 in full plus the kind-aware `termLabel`/`roleLabel`. Two deliberate deviations, both written back into the spec in Task 14:

1. **Per-kind German sentences select by nesting, not `context`.** The spec says `t(key, { context: kind })`. That needs `useOrgKind()` plus an options object at every affected call site. A runtime spike (i18next 23.16) confirmed that `"$t(ns:path.key_{{kind}})"` interpolates `{{kind}}` from `defaultVariables` first and then resolves the nested key, including plural suffixes, and re-renders when the bridge swaps tables. Same sibling keys as the spec (`key_production`, `key_staffing`), zero component edits.
2. **The email and PDF copy maps move to PR 3.** `emailCopy.ts` and `pdfCopy.ts` are file-mode mirrors that may not import anything, so their resolvers cannot reach `VOCABULARY`. Converting their defaults now would print literal `{{Production}}` into emails until PR 3 threads the table through `resolveEmailCopy`/`resolveHireOrderCopy`. PR 3 (R6) does the conversion and the threading together.

## Global Constraints

- Copy rules: no em or en dashes, no exclamation marks, no emoji; German is Du-form. `copyLint.test.ts`, `keyParity.test.ts`, `translationCompleteness.test.ts` enforce. English and German land in the same commit.
- **Production orgs render byte-identically.** For every key, `t(key)` under the production vocabulary must equal the string on `origin/main`, except for the deliberate rewordings the Rules section allows (article fixes, renamed runtime variables). Every such rewording is listed in the commit body. `VOCAB_DIFF=1 npx vitest run src/i18n/vocabularyDiff.test.ts` (Task 3) prints the diff.
- Never hand-edit a GENERATED file or block. `src/lib/orgKind.ts` is the SOURCE of the block mirrored into `supabase/functions/_shared/orgKind.ts`; `src/config/app.config.ts` is the source of the block in `supabase/functions/_shared/roles.ts`. After editing a source: `npm run sync:mirrors`, then `npm run sync:mirrors:check`.
- `any` is banned. Tests use `src/test/renderWithProviders.tsx`; never `vi.mock('@/integrations/supabase/client')`.
- Commit messages: imperative, lowercase, at most 72 chars, ending with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Branch: `claude/org-kind-pr2-copy-audit` (this worktree, cut from `origin/main` at 4b875201). Do not push or open the PR until Task 14 says so.
- No changelog entry, no version bump (nothing customer-visible changes for production orgs; the changelog entry ships with PR 3). No visual mockup gate: this PR changes words for staffing orgs only, no layout.
- `src/lib/dashboard/stageChain.ts` and `moduleOnboarding.ts` keep their hardcoded English (deferred to a future `onboarding` namespace per CLAUDE.md); they are out of scope here.

## Vocabulary and the noun rules

The four forms per noun, from `src/lib/orgKind.ts` (values shown production / staffing):

| Variable | EN | DE |
|---|---|---|
| `show`, `shows`, `Show`, `Shows` | show / project | Show / Projekt |
| `showDate`, `showDates`, `ShowDate`, `ShowDates` | date / shift | Termin / Schicht |
| `artist`, `artists`, `Artist`, `Artists` | artist, artists / staff member, people | Artist, Artists / Teammitglied, Personen |
| `production`, `productions`, `Production`, `Productions` | production / client | Produktion / Kunde |
| `cast`, `casts`, `Cast`, `Casts` | cast / team | Besetzung / Team |
| `understudy`, `understudies`, `Understudy`, `Understudies` | understudy / standby | Zweitbesetzung / Ersatz |
| `skill`, `skills`, `Skill`, `Skills` | skill / qualification | Skill / Qualifikation |
| `hireOrder`, `hireOrders`, `HireOrder`, `HireOrders` | contract / work order | Engagementvertrag / Arbeitsauftrag |
| `roleProducer` (Task 1) | Production Team / Booking team | Production Team / Buchungsteam |
| `kind` (Task 1) | `production` / `staffing` (the id itself, same in both languages) | |

### English rules (apply in this order)

1. **Replace the bare noun with the variable of the same number and case.** "Add your artists" becomes "Add your {{artists}}". "Cast created" becomes "{{Cast}} created". Sentence-initial words use the Capital form. Title-cased labels ("Add New Artist") become sentence case with the variable ("Add a new {{artist}}").
2. **"show date" / "show dates" is one noun:** the compound becomes `{{showDate}}` / `{{showDates}}` (production value "date"), never "{{show}} date". A bare "date(s)" that means the show-date entity is left alone (it already reads "date").
3. **Production and show are separate variables.** Copy that says "production" uses `{{production}}`; copy that says "show" uses `{{show}}`. Do not normalise one to the other.
4. **The role name.** "Production Team", "production team", "Producers", "the producers" become `{{roleProducer}}` ("{{roleProducer}} can archive productions" reads "Production Team can archive..." under production; if the sentence then needs a verb-number fix, use a form that works for both, e.g. "{{roleProducer}} may ..."). The role literal `producer` in code is never touched.
5. **Never put "a" or "an" directly before a variable.** Under production, `artist` and `understudy` take "an"; every staffing value takes "a". Rewrite with "one", "the", "your", "each", "any", "another", or "a new {{artist}}" (the adjective absorbs the article). "an artist" becomes "one {{artist}}" or "the {{artist}}" depending on meaning.
6. **Derived forms are reworded, not variablised.** "casting", "under-cast", "cast" as a verb, "artist-manager": say it in plain words ("fill", "short of people", "book", "the person who books"). The scanner counts them until they are gone.
7. **Plural keys.** `key_one` takes the singular variable, `key_other` the plural: `"imported_one": "Imported {{count}} {{artist}}"`, `"imported_other": "Imported {{count}} {{artists}}"`.
8. **Leave alone and allowlist (Task 14) with a reason:** proper nouns (`ShowFlow`), machine tokens documented for admins (the numbering placeholders `{cast}`, `{cast|seq}` in `settingsHireOrders.numberingCard.description`), Airtable example values ("Shows" as a sample table name), and the PR 1 picker copy already under `SKIP_PATHS`. Nothing else.
9. **Do not change meaning.** Under the production vocabulary the sentence must read as it did, apart from the article fixes in rule 5 and sentence-casing in rule 1. Each such change is listed in the commit body.

### German rules

German articles, adjective endings and pronouns follow the noun's gender, and the genders differ between kinds:

| Variable | Production DE (gender) | Staffing DE (gender) |
|---|---|---|
| Show | Show (f) | Projekt (n) |
| ShowDate | Termin (m) | Schicht (f) |
| Artist | Artist (m) | Teammitglied (n) |
| Production | Produktion (f) | Kunde (m) |
| Cast | Besetzung (f) | Team (n) |
| Understudy | Zweitbesetzung (f) | Ersatz (m) |
| Skill | Skill (m) | Qualifikation (f) |
| HireOrder | Engagementvertrag (m) | Arbeitsauftrag (m) |

Apply in this order:

1. **Plural with a gender-free determiner takes the variable directly.** "deine / alle / keine / {{count}} / mehrere / viele" + plural work for every gender: "Deine Produktionen sind eingetragen." becomes "Deine {{Productions}} sind eingetragen."; "Keine Artists gefunden." becomes "Keine {{Artists}} gefunden.".
2. **Verb-final imperatives and bare nominatives take the variable.** "Produktion auswählen" becomes "{{Production}} auswählen"; "Neuen Artist hinzufügen" becomes "{{Artist}} hinzufügen"; "Unbekannter Artist" becomes "{{Artist}} unbekannt"; "Artist" (a column header) becomes "{{Artist}}".
3. **Hyphenated compounds keep the hyphen:** "Artist-Profil" becomes "{{Artist}}-Profil". Fused compounds ("Besetzungsplan", "Produktionsvorgabe", "Künstlerannahme") are reworded to a phrase ("Plan für {{Casts}}", "Vorgabe der {{Production}}" is NOT allowed because of the article; use "Standard aus {{Production}}" only if it reads naturally, otherwise rule 5).
4. **Normalise stray synonyms.** "Künstler", "Vorstellung" and "Produktionsteam" in German copy become `{{Artist}}`/`{{Artists}}`, `{{Show}}`, `{{roleProducer}}`.
5. **If a singular noun needs an article, an adjective ending or a pronoun ("eine Produktion", "der Artist", "neue Show", "ihn"), and no rewording under rules 1 to 3 reads naturally, add per-kind sibling keys in the German file only:**

   ```json
   "newProduction": "$t(productions:page.newProduction_{{kind}})",
   "newProduction_production": "Neue Produktion",
   "newProduction_staffing": "Neuer Kunde"
   ```

   Rules for siblings: the base key's value is exactly `$t(<namespace>:<full.dotted.path>_{{kind}})` with the explicit namespace prefix (a consumer may call `t` from another namespace); both `_production` and `_staffing` siblings exist; siblings never appear in the English file (the English sentence uses variables). For plural keys the outer key keeps its plural suffix and points at a sibling that carries both: `"x_one": "$t(today:feed.x_{{kind}}_one)"`, `"x_production_one": "..."`, `"x_staffing_one": "..."`, and the same for `_other`. `keyParity.test.ts` (Task 2) allows exactly this shape and nothing else. The sibling text is the full German sentence with no variables inside it.
6. **Never add a fifth noun form** (no `derArtist`, no `ArtistAkk`). Rule 5 is the only escape hatch.
7. **Do not touch** the four `SKIP_PATHS` keys (the picker copy) and the machine-token strings from English rule 8.

Draft all staffing German yourself; the owner reviews the German diff of the PR.

### Verifying a batch

Every audit task ends with the same five commands. All must pass before the commit.

```bash
VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts     # prints every remaining hit as "<path> (<n>)"; none may start with your namespaces
npx vitest run src/i18n                                            # keyParity, copyLint, translationCompleteness, kindVariants, scanner
VOCAB_DIFF=1 npx vitest run src/i18n/vocabularyDiff.test.ts        # prints production-vocabulary diffs vs origin/main; only the rewordings you listed may appear
npx tsc -p tsconfig.app.json --noEmit
npx vitest run <the component directories that consume your namespaces>   # tests that assert literal English strings
```

Then lower `BASELINE` in `src/i18n/vocabularyLint.test.ts` to the total the report printed (never raise it) and commit.

---

## Task 1: Registry: `roleProducer`, `kind`, and `interpolateVocabulary`

**Files:**
- Modify: `src/lib/orgKind.ts` (the `VocabKey` union, the four tables, add the helper inside the mirror block)
- Modify: `src/lib/orgKind.test.ts`
- Regenerate: `supabase/functions/_shared/orgKind.ts` (via `npm run sync:mirrors`)

**Interfaces:**
- Produces: `VocabKey` gains `"roleProducer" | "kind"`; `interpolateVocabulary(text: string, vocab: Vocabulary): string` replaces every `{{name}}` whose `name` is a key of `vocab` and leaves any other `{{...}}` untouched.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/orgKind.test.ts`)

```ts
import { interpolateVocabulary } from "./orgKind";

describe("vocabulary extensions", () => {
  it("carries the role label and the kind id", () => {
    expect(VOCABULARY.production.en.roleProducer).toBe("Production Team");
    expect(VOCABULARY.staffing.en.roleProducer).toBe("Booking team");
    expect(VOCABULARY.staffing.de.roleProducer).toBe("Buchungsteam");
    for (const kind of ORG_KINDS) for (const lang of ["en", "de"] as const) expect(VOCABULARY[kind][lang].kind).toBe(kind);
  });
});

describe("interpolateVocabulary", () => {
  const vocab = VOCABULARY.staffing.en;
  it("replaces known vocabulary variables, every occurrence", () => {
    expect(interpolateVocabulary("Add a {{artist}} to the {{cast}}. {{Artists}} first.", vocab))
      .toBe("Add a staff member to the team. People first.");
  });
  it("leaves runtime variables and unknown tokens alone", () => {
    expect(interpolateVocabulary("{{count}} {{shows}} for {{showTitle}}", vocab)).toBe("{{count}} projects for {{showTitle}}");
  });
  it("is the identity on text without variables", () => {
    expect(interpolateVocabulary("plain", vocab)).toBe("plain");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/orgKind.test.ts`
Expected: FAIL (`interpolateVocabulary` is not exported; `roleProducer` undefined).

- [ ] **Step 3: Implement** in `src/lib/orgKind.ts`, inside the mirror block

Extend the union:

```ts
  | "hireOrder" | "hireOrders" | "HireOrder" | "HireOrders"
  | "roleProducer"
  | "kind";
```

Add to each of the four tables (after the `hireOrder` line):

```ts
      roleProducer: "Production Team", kind: "production",      // production.en
      roleProducer: "Production Team", kind: "production",      // production.de
      roleProducer: "Booking team", kind: "staffing",           // staffing.en
      roleProducer: "Buchungsteam", kind: "staffing",           // staffing.de
```

Add the helper before the closing sentinel:

```ts
/**
 * Plain {{name}} substitution from a vocabulary table, for copy that does not go through
 * i18next (Help items, glossary, page minis, and in PR 3 the email and PDF copy maps).
 * Unknown tokens (runtime variables like {{count}}) are left verbatim.
 */
export function interpolateVocabulary(text: string, vocab: Vocabulary): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vocab, name) ? vocab[name as VocabKey] : whole,
  );
}
```

- [ ] **Step 4: Regenerate the edge mirror and check both runtimes**

Run: `npm run sync:mirrors && npm run sync:mirrors:check && npx vitest run src/lib/orgKind.test.ts src/features/i18n && deno check --node-modules-dir=none supabase/functions/provision-org/index.ts`
Expected: all pass; `supabase/functions/_shared/orgKind.ts` diff shows only the block.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orgKind.ts src/lib/orgKind.test.ts supabase/functions/_shared/orgKind.ts
git commit -m "add roleProducer and kind vocabulary plus interpolateVocabulary"
```

---

## Task 2: Per-kind German siblings: the nesting mechanism test and key-parity rule

**Files:**
- Create: `src/i18n/kindVariants.test.ts`
- Modify: `src/i18n/keyParity.test.ts`

**Interfaces:**
- Produces: the guaranteed contract audit tasks rely on: a German base key valued `$t(<ns>:<path>_{{kind}})` renders the `_production` sibling under production and the `_staffing` sibling under staffing, for plain and plural keys, whether `t` is bound to that namespace or another one. `keyParity` accepts German-only siblings of that exact shape.

- [ ] **Step 1: Write the mechanism test**

```ts
// src/i18n/kindVariants.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import i18n from "@/i18n";
import { applyVocabulary } from "@/features/i18n/vocabulary";

/**
 * German sentences that cannot take a bare noun variable (article, adjective ending,
 * pronoun) use per-kind sibling keys selected by i18next nesting on the `kind`
 * vocabulary variable: "$t(ns:path.key_{{kind}})". This pins the behaviour the copy
 * audit relies on so an i18next upgrade cannot silently break it.
 */
const NS = "kindVariantsTest";
const de = {
  page: {
    add: "$t(kindVariantsTest:page.add_{{kind}})",
    add_production: "Neue Produktion",
    add_staffing: "Neuer Kunde",
    count_one: "$t(kindVariantsTest:page.count_{{kind}}_one)",
    count_other: "$t(kindVariantsTest:page.count_{{kind}}_other)",
    count_production_one: "{{count}} Termin",
    count_production_other: "{{count}} Termine",
    count_staffing_one: "{{count}} Schicht",
    count_staffing_other: "{{count}} Schichten",
    plain: "Deine {{Productions}}",
  },
};

describe("per-kind German siblings via nesting", () => {
  beforeAll(async () => {
    i18n.addResourceBundle("de", NS, de, true, true);
    i18n.addResourceBundle("en", NS, { page: { add: "New {{production}}", count_one: "{{count}} {{showDate}}", count_other: "{{count}} {{showDates}}", plain: "Your {{productions}}" } }, true, true);
    await i18n.changeLanguage("de");
  });
  afterAll(async () => {
    applyVocabulary(i18n, "production", "en");
    await i18n.changeLanguage("en");
  });

  it("selects the production sibling under the production vocabulary", () => {
    applyVocabulary(i18n, "production", "de");
    expect(i18n.t("page.add", { ns: NS })).toBe("Neue Produktion");
    expect(i18n.t("page.plain", { ns: NS })).toBe("Deine Produktionen");
  });

  it("selects the staffing sibling after the table swaps", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.t("page.add", { ns: NS })).toBe("Neuer Kunde");
    expect(i18n.t("page.plain", { ns: NS })).toBe("Deine Kunden");
  });

  it("resolves when t is bound to a different namespace", () => {
    applyVocabulary(i18n, "staffing", "de");
    const t = i18n.getFixedT("de", "common");
    expect(t(`${NS}:page.add`)).toBe("Neuer Kunde");
  });

  it("carries the plural suffix and the count through the sibling", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.t("page.count", { ns: NS, count: 1 })).toBe("1 Schicht");
    expect(i18n.t("page.count", { ns: NS, count: 3 })).toBe("3 Schichten");
    applyVocabulary(i18n, "production", "de");
    expect(i18n.t("page.count", { ns: NS, count: 3 })).toBe("3 Termine");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/i18n/kindVariants.test.ts`
Expected: PASS (this documents behaviour that already exists; if any case fails, stop and report, the audit tasks depend on it. Do not change the mechanism without the owner).

- [ ] **Step 3: Write the failing key-parity test.** Replace the body of the `it` in `src/i18n/keyParity.test.ts` with:

```ts
// German may carry per-kind sibling keys that English does not need (English uses
// vocabulary variables; German grammar sometimes cannot). The only allowed shape:
//   base key present in both languages, German base value "$t(ns:path_{{kind}})",
//   and BOTH `_production` and `_staffing` siblings present in German.
const KIND_SIBLING = /^(.+)_(production|staffing)((?:_(?:one|other))?)$/;

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
```

and add above the `describe`:

```ts
/** Read one dotted leaf out of a catalog object. */
function leaf(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
```

- [ ] **Step 4: Run the parity test**

Run: `npx vitest run src/i18n/keyParity.test.ts`
Expected: PASS (no siblings exist yet; the test still passes on today's files). Temporarily add `"x_staffing": "y"` to `src/i18n/locales/de/chats.json`, re-run, expect the "sibling x_production missing" failure, then revert the file.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/kindVariants.test.ts src/i18n/keyParity.test.ts
git commit -m "pin per-kind german siblings via nesting and allow them in key parity"
```

---

## Task 3: Scanner v2 and the production-diff report

**Files:**
- Create: `src/i18n/vocabularyScan.ts`
- Modify: `src/i18n/vocabularyLint.test.ts` (rewrite)
- Create: `src/i18n/vocabularyDiff.test.ts`

**Interfaces:**
- Produces: `englishSources(): Array<[path, text]>` (every English string from the locale files, `HELP_ITEMS` q/a, `GLOSSARY` def, every mini eyebrow/subnote/step label/text); `scanBareNouns(sources, skipPaths): VocabHit[]` where `VocabHit = { path: string; text: string; count: number }`; `capitalisedTokens(sources): Array<[path, token]>`. The lint test exposes `VOCAB_REPORT=1` (prints hits) and the diff test exposes `VOCAB_DIFF=1` (prints production-vocabulary diffs against `origin/main`). Path conventions: locale `<ns>.<dotted.key>`, help `help-items.<id>.q|a`, glossary `help-glossary.<term>`, minis `minis.<page>.eyebrow|subnote|<role>[<i>].label|text`.

- [ ] **Step 1: Write the scanner module**

```ts
// src/i18n/vocabularyScan.ts
import { resources } from "@/i18n";
import { HELP_ITEMS } from "@/lib/help/items";
import { GLOSSARY } from "@/lib/help/glossary";
import { MINIS, PAGE_KEYS } from "@/lib/minis";
import { VOCABULARY } from "@/lib/orgKind";

export interface VocabHit { path: string; text: string; count: number }

/** Bare domain nouns that must be vocabulary variables. Case-insensitive. */
export const NOUN = /\b(shows?|artists?|productions?|casts?|understud(?:y|ies)|hire orders?)\b/gi;

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
```

- [ ] **Step 2: Rewrite the lint test**

```ts
// src/i18n/vocabularyLint.test.ts
import { describe, it, expect } from "vitest";
import { englishSources, scanBareNouns, capitalisedTokens } from "./vocabularyScan";

/**
 * Ratchet: the number of bare domain nouns in English copy may never grow. The copy audit
 * (PR 2 tasks 7 to 13) drives BASELINE to 0, then Task 14 replaces it with ALLOW.
 * `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts` prints every hit.
 */
const BASELINE = 0; // Task 3 step 4 replaces this with the measured total

// Key-path prefixes exempt from the scan: copy that legitimately names both vocabularies
// (the workspace-type picker explains what each option means).
const SKIP_PATHS = [
  "settings.organization.kind",
  "getRunningV3.steps.workspace",
  "getRunningV3.body.workspace",
  "getRunningV3.guide.workspace",
];

describe("vocabulary ratchet", () => {
  const sources = englishSources();

  it("bare domain nouns in English copy do not exceed the baseline", () => {
    const hits = scanBareNouns(sources, SKIP_PATHS);
    const lines = hits.map((h) => `${h.path} (${h.count})`);
    const total = hits.reduce((s, h) => s + h.count, 0);
    if (process.env.VOCAB_REPORT) console.log(`${lines.join("\n")}\nTOTAL ${total}`);
    expect(total, `bare nouns grew past the baseline. Offenders:\n${lines.join("\n")}`).toBeLessThanOrEqual(BASELINE);
  });

  it("every capitalised {{Token}} is a vocabulary key", () => {
    expect(capitalisedTokens(sources)).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the diff report test**

```ts
// src/i18n/vocabularyDiff.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import i18n, { resources } from "@/i18n";
import { applyVocabulary } from "@/features/i18n/vocabulary";
import type { Lang } from "./config";

/**
 * Production orgs must render byte-identically after the copy audit. This report
 * renders every locale key under the production vocabulary (variables and per-kind
 * siblings resolved) and diffs it against the same key on origin/main. Runs only with
 * VOCAB_DIFF=1 (it shells out to git); prints the differences and never fails, so the
 * executor and the reviewer can read the deliberate rewordings.
 */
function flat(node: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[path] = node;
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flat(v, path ? `${path}.${k}` : k, out);
  return out;
}

const run = process.env.VOCAB_DIFF ? describe : describe.skip;

run("production-vocabulary diff against origin/main", () => {
  for (const lang of ["en", "de"] as Lang[]) {
    it(`prints ${lang} differences`, async () => {
      await i18n.changeLanguage(lang);
      applyVocabulary(i18n, "production", lang);
      const diffs: string[] = [];
      for (const ns of Object.keys(resources[lang])) {
        let before: Record<string, string> = {};
        try { before = flat(JSON.parse(execSync(`git show origin/main:src/i18n/locales/${lang}/${ns}.json`, { encoding: "utf8" }))); } catch { continue; }
        for (const [key, old] of Object.entries(before)) {
          const now = i18n.t(key, { ns, lng: lang });
          if (now !== old) diffs.push(`${ns}.${key}\n  main: ${old}\n  now:  ${now}`);
        }
      }
      console.log(`[${lang}] ${diffs.length} differences\n${diffs.join("\n")}`);
      expect(true).toBe(true);
    });
  }
});
```

- [ ] **Step 4: Measure and pin the baseline**

Run: `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts`
Expected: FAIL on the ratchet (BASELINE 0) with `TOTAL <n>` printed (expect roughly 700: the old 683 minus the `{{show}}`-style tokens that were miscounted, plus the Help items, glossary and minis now scanned). Set `const BASELINE = <n>;` to that exact number. The capitalised-token test must already pass.

Run: `npx vitest run src/i18n && VOCAB_DIFF=1 npx vitest run src/i18n/vocabularyDiff.test.ts`
Expected: all pass; the diff report prints `0 differences` for both languages.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/vocabularyScan.ts src/i18n/vocabularyLint.test.ts src/i18n/vocabularyDiff.test.ts
git commit -m "extend the noun scanner to help and minis and add a production diff report"
```

---

## Task 4: Rename the runtime variables that collide with vocabulary keys

Copy already uses `{{show}}` (a show's title), `{{cast}}` (a cast's name), `{{artist}}` (a person's name) and `{{artists}}`/`{{productions}}` (counts) as runtime interpolation variables. Explicit `t()` options still win over `defaultVariables`, so nothing is broken today, but after the audit `{{show}}` must mean the noun everywhere. Rename the runtime ones first.

**Files:**
- Modify (EN and DE): `productions.json` (`form.slotTotals`, `form.callout.withSkills`), `showsDetail.json` (`eligibilityBookList.reqHasSkills`, the `bodyWithSkills_*` pair, `requiredSkillsCard.computedFrom`), `bookingCopy.json` (`actionCopy.cancel.title`, `actionCopy.cancel.understudyLine`), `getRunning.json` (`panel.body.eligibility.unlocks_one|_other`), `settingsCastsCoverage.json` (`coverage.followsDefault`, `coverage.overridesSummary`), `settingsTrust.json` (`orgDataCard.recordsNote`, `orgDataCard.rolesHeld`), `showsDetail.json` (`requiredSkillsCard.computedFrom`), `today.json` (`atRisk.openCastTitle`, `bounced.body`, `feed.book_*`, `feed.bookHold_*`, `feed.bookHoldAdmin_*`, `feed.ask_*`, `feed.draft_*`, `feed.notify`, `toast.castAskedSuccess`, `toast.castAskedError`)
- Modify call sites: `src/components/catalog/CastingBreakdownFields.tsx:84,92`, `src/components/shows/date/EligibilityBookList.tsx:34` (and the consumer of `bodyWithSkills`, grep it), `src/lib/bookings/actionCopy.ts:118-120`, `src/components/getRunning/panels/EligibilityPanelBody.tsx:342`, `src/components/settings/castsCoverage/CoveragePanel.tsx:608-609`, `src/components/settings/trust/OrgDataCard.tsx:153` (and the `rolesHeld` call just below it), `src/components/shows/` consumer of `requiredSkillsCard.computedFrom` (grep `computedFrom`), `src/components/today/AtRiskDateCard.tsx:74`, `src/components/today/BouncedAsksBanner.tsx:38`, `src/components/today/feedRowText.ts:28-36` (and the `notify` branch), the consumer of `toast.castAsked*` (grep `castAskedSuccess`)

**Interfaces:**
- Produces: the renamed runtime variables `showTitle`, `castName`, `artistName`, `artistCount`, `productionCount`. No other file may use `{{show}}`, `{{cast}}`, `{{artist}}`, `{{artists}}`, `{{productions}}` as a runtime variable from here on.

- [ ] **Step 1: Write the guard test** (append to `src/i18n/vocabularyLint.test.ts`)

```ts
import { VOCABULARY } from "@/lib/orgKind";

  it("no call site passes a vocabulary key as a runtime interpolation variable", () => {
    // Grep-level guard: t('key', { show: ... }) would shadow the noun. Runtime variables
    // are showTitle / castName / artistName / artistCount / productionCount.
    const src = execSync("git grep -nE \"\\bt\\([^)]*\\{[^}]*\\b(show|shows|cast|casts|artist|artists|production|productions|skill|skills|showDate|showDates|understudy|understudies|hireOrder|hireOrders)\\s*:\" -- src ':!*.test.*'", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    expect(src, "rename the variable (showTitle / castName / artistName / artistCount / productionCount / skillNames / understudyCount)").toBe("");
  });
```

(import `execSync` from `node:child_process` at the top; `git grep` exits 1 with empty output when nothing matches, hence the try-free `stdio` ignore on stderr and `.trim()`; wrap the `execSync` in `try { ... } catch { "" }` so a no-match exit code yields the empty string.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/i18n/vocabularyLint.test.ts`
Expected: FAIL listing the call sites above.

- [ ] **Step 3: Rename in the JSON (both languages) and at every call site.** Mapping:

| Old | New |
|---|---|
| `{{show}}` (a title) | `{{showTitle}}` |
| `{{cast}}` (a name) | `{{castName}}` |
| `{{artist}}` (a name) | `{{artistName}}` |
| `{{artists}}` in `settingsTrust.orgDataCard.recordsNote` / `rolesHeld` | `{{artistCount}}` |
| `{{productions}}` in `settingsTrust.orgDataCard.recordsNote` | `{{productionCount}}` |
| `{{skills}}` (a joined list of skill names) in `showsDetail.eligibilityBookList.reqHasSkills`, `showsDetail.*.bodyWithSkills_one|_other`, `productions.form.callout.withSkills` | `{{skillNames}}` |
| `{{understudy}}` (a slot count) in `productions.form.slotTotals` | `{{understudyCount}}` |

Example, `src/components/today/feedRowText.ts`:

```ts
return t("feed.book", { count: row.count, names: row.names, showTitle: row.show, date: row.date });
```

and `today.json` (EN): `"book_one": "Booked {{names}} onto {{showTitle}}, {{date}}. They said yes, so the part is theirs."`. Apply the same in DE.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/i18n src/components/today src/components/settings src/components/getRunning src/lib/bookings src/components/shows && npx tsc -p tsconfig.app.json --noEmit && VOCAB_DIFF=1 npx vitest run src/i18n/vocabularyDiff.test.ts`
Expected: all pass. The diff report lists exactly the renamed keys (the literal token name changed) and nothing else. Re-run the report after this task and note that the ratchet total does not change (tokens were already stripped).

- [ ] **Step 5: Commit**

```bash
git add -A src/i18n src/lib/bookings src/components
git commit -m "rename runtime variables that shadow vocabulary keys"
```

---

## Task 5: Kind-aware `termLabel` and `roleLabel`

**Files:**
- Modify: `src/i18n/terms.ts`, `src/i18n/terms.test.ts`
- Modify: `src/config/app.config.ts` (the `roleLabel` inside the ROLE LABELS MIRROR block, plus one import above the block)
- Modify: `supabase/functions/_shared/roles.ts` (one import line above the block; the block itself is regenerated)
- Create: `src/config/roleLabel.test.ts`

**Interfaces:**
- Produces: `termLabel(key: TermKey, lang: Lang, kind: OrgKind = DEFAULT_ORG_KIND): string`; `roleLabel(role: string, kind: OrgKind = DEFAULT_ORG_KIND): string`. Defaults keep every existing call byte-identical; PR 3 passes `useOrgKind()` at the consumers that matter.

- [ ] **Step 1: Write the failing tests**

Append to `src/i18n/terms.test.ts`:

```ts
  it('termLabel follows the workspace type for the three vocabulary terms', () => {
    expect(termLabel('cast', 'en')).toBe('Cast');
    expect(termLabel('cast', 'en', 'staffing')).toBe('Team');
    expect(termLabel('understudy', 'de', 'staffing')).toBe('Ersatz');
    expect(termLabel('hireOrder', 'en', 'staffing')).toBe('Work order');
    expect(termLabel('hold', 'de', 'staffing')).toBe('Wartet auf dich'); // untouched term
  });
```

Create `src/config/roleLabel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roleLabel, ROLE_LABELS } from './app.config';

describe('roleLabel', () => {
  it('defaults to the production table', () => {
    expect(roleLabel('producer')).toBe(ROLE_LABELS.producer);
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('unknown')).toBe('unknown');
  });
  it('reads the producer label from the vocabulary for staffing', () => {
    expect(roleLabel('producer', 'staffing')).toBe('Booking team');
    expect(roleLabel('artist', 'staffing')).toBe('Artist'); // only the producer label is kind-aware in this PR
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/i18n/terms.test.ts src/config/roleLabel.test.ts`
Expected: FAIL (third argument ignored / second argument ignored).

- [ ] **Step 3: Implement `termLabel`** in `src/i18n/terms.ts`

```ts
import { VOCABULARY, DEFAULT_ORG_KIND, type OrgKind, type VocabKey } from '@/lib/orgKind';

/** Terms whose label is a workspace-type noun; the rest are kind-independent. */
const KIND_TERMS = { cast: 'Cast', understudy: 'Understudy', hireOrder: 'HireOrder' } as const satisfies Partial<Record<TermKey, VocabKey>>;

export function termLabel(key: TermKey, lang: Lang, kind: OrgKind = DEFAULT_ORG_KIND): string {
  const vocabKey = (KIND_TERMS as Partial<Record<TermKey, VocabKey>>)[key];
  return vocabKey ? VOCABULARY[kind][lang][vocabKey] : TERMS[key][lang];
}
```

- [ ] **Step 4: Implement `roleLabel`.** In `src/config/app.config.ts`, above the `// >>> ROLE LABELS MIRROR` sentinel add `import { VOCABULARY, DEFAULT_ORG_KIND, type OrgKind } from '@/lib/orgKind';` (with the file's other imports). Inside the block replace the `roleLabel` definition with:

```ts
/** Display label for a role. Tolerant of unknown strings (falls back to the raw value).
 *  The producer label follows the workspace type (VOCABULARY[kind].en.roleProducer);
 *  labels are English-only by convention. */
export const roleLabel = (role: string, kind: OrgKind = DEFAULT_ORG_KIND): string =>
  role === 'producer' ? VOCABULARY[kind].en.roleProducer : (ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role);
```

In `supabase/functions/_shared/roles.ts`, above its sentinel add `import { VOCABULARY, DEFAULT_ORG_KIND, type OrgKind } from './orgKind.ts';`. Then `npm run sync:mirrors`.

- [ ] **Step 5: Verify**

Run: `npm run sync:mirrors:check && npx vitest run src/i18n/terms.test.ts src/config src/components/help && npx tsc -p tsconfig.app.json --noEmit && deno check --node-modules-dir=none supabase/functions/create-invitation/index.ts supabase/functions/provision-org/index.ts && deno test --allow-all supabase/functions/_shared/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/terms.ts src/i18n/terms.test.ts src/config/app.config.ts src/config/roleLabel.test.ts supabase/functions/_shared/roles.ts
git commit -m "make termLabel and roleLabel workspace-type aware with production defaults"
```

---

## Task 6: Vocabulary at render time for Help items, glossary and page minis

These three copy modules are typed bilingual TypeScript, not i18next, so `{{noun}}` in them needs an explicit substitution at the render site.

**Files:**
- Create: `src/hooks/useVocabulary.ts`, `src/hooks/useVocabulary.test.tsx`
- Modify: `src/components/help/HelpItemRow.tsx:27,43`, `src/components/help/HelpGlossary.tsx:15`
- Modify: `src/components/minis/PageMini.tsx` (`PageMiniViewProps` gains `vocab`; `PageMiniView` applies it at lines 35, 44, 48, 56, 74, 78; the container passes it)
- Modify: `src/components/minis/PageMini.test.tsx` (pass `vocab`)

**Interfaces:**
- Produces: `useVocabulary(): Vocabulary` (the active org's table for the active language); `PageMiniViewProps.vocab: Vocabulary` (required).

- [ ] **Step 1: Write the failing hook test**

```tsx
// src/hooks/useVocabulary.test.tsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useVocabulary } from "./useVocabulary";
import { VOCABULARY } from "@/lib/orgKind";

function Probe() {
  const v = useVocabulary();
  return <p data-testid="probe">{v.Artists}</p>;
}

describe("useVocabulary", () => {
  it("returns the production English table by default", () => {
    const { getByTestId } = renderWithProviders(<Probe />);
    expect(getByTestId("probe").textContent).toBe(VOCABULARY.production.en.Artists);
  });
  it("follows the active org's kind", () => {
    const { getByTestId } = renderWithProviders(<Probe />, {
      currentOrg: { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing", org_kind_set_at: null },
    });
    expect(getByTestId("probe").textContent).toBe("People");
  });
});
```

(Check `src/test/renderWithProviders.tsx` for the exact name of the auth-override argument; PR 1's `OrgKindSelect.test.tsx` and `VocabularyBridge.test.tsx` show the shape. Remove the unused `renderHook` import if you use the Probe component.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useVocabulary.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useVocabulary.ts
import { useLanguage } from "@/features/i18n/LanguageContext";
import { useOrgKind } from "@/hooks/useOrgKind";
import { VOCABULARY, type Vocabulary } from "@/lib/orgKind";

/** The active org's vocabulary table for the active language, for copy modules that
 *  bypass i18next (Help items, glossary, page minis). Pair with interpolateVocabulary. */
export function useVocabulary(): Vocabulary {
  const kind = useOrgKind();
  const { lang } = useLanguage();
  return VOCABULARY[kind][lang];
}
```

- [ ] **Step 4: Wire the render sites.** `HelpItemRow.tsx`:

```tsx
import { interpolateVocabulary } from '@/lib/orgKind';
import { useVocabulary } from '@/hooks/useVocabulary';
// inside the component:
const vocab = useVocabulary();
// line 27:  {interpolateVocabulary(item.q[lang], vocab)}
// line 43:  {interpolateVocabulary(item.a[lang], vocab)}
```

`HelpGlossary.tsx` line 15: `{interpolateVocabulary(g.def[lang], vocab)}` with the same hook (the card title already goes through `termLabel`; pass `useOrgKind()` as its third argument here so the glossary title follows the kind too: `termLabel(g.term, lang, kind)`).

`PageMini.tsx`: add `vocab: Vocabulary` to `PageMiniViewProps`; inside `PageMiniView` wrap `def.eyebrow[lang]`, `def.subnote[lang]`, `step.label[lang]`, `step.text[lang]` in `interpolateVocabulary(..., vocab)`; in the container pass `vocab={useVocabulary()}` (call the hook at the top of the container next to `useLanguage()`). Update `PageMini.test.tsx` to pass `vocab={VOCABULARY.production.en}`.

- [ ] **Step 5: Add one substitution test per surface.** Append to `src/components/minis/PageMini.test.tsx`:

```tsx
  it('substitutes vocabulary variables in step copy', () => {
    const def = { ...MINIS.artists, eyebrow: { en: 'What {{artists}} are', de: 'Was {{Artists}} sind' } } as MiniDef;
    render(<PageMiniView def={def} role="admin" lang="en" art={ART.artists} dismissed={false} onHide={() => {}} onResume={() => {}} vocab={VOCABULARY.staffing.en} />);
    expect(screen.getByText('What people are')).toBeInTheDocument();
  });
```

and a `HelpItemRow` test (create `src/components/help/HelpItemRow.test.tsx` if none exists) rendering an item whose `q.en` is `'How do I add one {{artist}}?'` through `renderWithProviders` with a staffing `currentOrg`, expecting the text `'How do I add one staff member?'`.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/hooks/useVocabulary.test.tsx src/components/minis src/components/help src/i18n && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: all pass, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useVocabulary.ts src/hooks/useVocabulary.test.tsx src/components/help src/components/minis
git commit -m "substitute vocabulary in help items, glossary and page minis"
```

---

## Tasks 7 to 12: the locale audit, six batches

Each batch is one task with the same steps; only the namespaces and the consumer test directories differ. Batches are sized to roughly 100 English hits. Run them in order (they touch disjoint files, so parallel subagents are fine if each commits only its own namespaces).

| Task | Namespaces (EN hits on main) | Consumer test dirs to run |
|---|---|---|
| 7 | `getRunningV3` (110) | `src/components/getRunning`, `src/pages` |
| 8 | `showsDetail` (88) | `src/components/shows` |
| 9 | `getRunning` (69), `onboarding` (60) | `src/components/getRunning`, `src/components/dashboard`, `src/components/bookings`, `src/lib/dashboard` |
| 10 | `hireOrdersPages` (52), `settingsHireOrders` (8), `settingsRolesRights` (32), `settingsSkills` (11), `settingsTrust` (11) | `src/components/hireOrders`, `src/components/shows/hireOrders`, `src/components/settings`, `src/pages` |
| 11 | `today` (35), `artists` (30), `productions` (27), `settingsCastsCoverage` (27) | `src/components/today`, `src/components/artists`, `src/components/catalog`, `src/components/settings/castsCoverage`, `src/pages` |
| 12 | `bookingCopy` (23), `bookings` (19), `settingsBookingFlow` (20), `settingsAirtable` (16), `availability` (10), `dashboard` (8), `help` (9), `flowCopy` (5), `profile` (4), `chats` (3), `common` (2), `settings` (2), `admin` (1), `auth` (1) | `src/lib/bookings`, `src/components/bookings`, `src/components/settings`, `src/components/availability`, `src/components/dashboard`, `src/components/help`, `src/components/layout`, `src/components/chat`, `src/pages` |

### Steps for each batch

**Files:** Modify `src/i18n/locales/en/<ns>.json` and `src/i18n/locales/de/<ns>.json` for every namespace in the batch; modify `src/i18n/vocabularyLint.test.ts` (`BASELINE` only); modify any consumer test that asserted a reworded literal.

- [ ] **Step 1: List your hits**

Run: `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts 2>&1 | grep -E "^(<ns1>|<ns2>)\."`
Read each listed key in both `en/<ns>.json` and `de/<ns>.json`.

- [ ] **Step 2: Rewrite English** per the English rules. Work key by key; do not touch keys that were not listed unless rule 4 (role name) or rule 2 (compound) applies to them. Keep the JSON key order.

- [ ] **Step 3: Rewrite German** per the German rules. For every key you changed in English, change the German. Prefer rules 1 to 4; use rule 5 siblings only when the sentence otherwise reads wrong. Write the staffing sibling text yourself (Du-form, no dashes).

- [ ] **Step 4: Verify the batch**

```bash
VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts 2>&1 | grep -E "^(<ns1>|<ns2>)\."    # expected: no output
npx vitest run src/i18n                                                                             # expected: only the ratchet may fail, on the total
VOCAB_DIFF=1 npx vitest run src/i18n/vocabularyDiff.test.ts 2>&1 | grep -A2 -E "^(<ns1>|<ns2>)\."  # expected: only article fixes / sentence-casing
npx tsc -p tsconfig.app.json --noEmit
npx vitest run <consumer test dirs>                                                                 # fix tests that asserted a reworded literal
```

- [ ] **Step 5: Lower the baseline.** Set `BASELINE` in `src/i18n/vocabularyLint.test.ts` to the `TOTAL` the report printed. Run `npx vitest run src/i18n` again; expected: all pass.

- [ ] **Step 6: Commit** with the rewordings in the body:

```bash
git add src/i18n/locales/en/<ns>.json src/i18n/locales/de/<ns>.json src/i18n/vocabularyLint.test.ts <changed tests>
git commit -F- <<'MSG'
audit <ns1> and <ns2> copy for vocabulary variables

Production rendering changes (article fixes and casing only):
- <ns>.<key>: "an artist" -> "one {{artist}}"
- ...
German siblings added: <n> keys.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

## Task 13: Audit the Help items, glossary and page minis

**Files:**
- Modify: `src/lib/help/items.ts` (86 items; about 100 English hits), `src/lib/help/glossary.ts` (14), `src/lib/minis/pages/*.ts` (about 30 English hits), `src/i18n/vocabularyLint.test.ts` (`BASELINE`)
- Modify if a literal was asserted: `src/lib/help/items.test.ts`, `src/lib/minis/minis.test.ts`, `src/components/minis/PageMini.test.tsx`, `src/components/help/*.test.tsx`

Same English and German rules as the locale batches, with two differences: these strings are substituted by `interpolateVocabulary` (Task 6), which knows no nesting, so **German rule 5 is not available here**. A German sentence that cannot take a bare variable is reworded (rules 1 to 4) or, if it cannot be, left with the production noun and listed in the PR description under "German help/mini strings still production-specific" for PR 3's `byKind` variants (spec R5.2, R5.3) to replace. English must reach zero.

- [ ] **Step 1: List the hits**

Run: `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts 2>&1 | grep -E "^(help-items|help-glossary|minis)\."`

- [ ] **Step 2: Rewrite English and German** in the three modules. Keep every item's `id`, `role`, `stage`, `status`, `surface`, `updated` untouched (`items.test.ts` pins the count 86 and the ids).

- [ ] **Step 3: Verify**

```bash
VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts 2>&1 | grep -E "^(help-items|help-glossary|minis)\."   # expected: no output
npx vitest run src/i18n src/lib/help src/lib/minis src/components/help src/components/minis
npx tsc -p tsconfig.app.json --noEmit
```

The diff report does not cover these modules (they are not locale JSON). Instead run, once, a manual spot check: `npx vitest run src/components/help` with an added temporary assertion is not needed; rely on `copyLint` (dashes, Du) and the review of the diff.

- [ ] **Step 4: Lower `BASELINE`** to the printed total and commit:

```bash
git add src/lib/help src/lib/minis src/i18n/vocabularyLint.test.ts src/components
git commit -m "audit help items, glossary and page minis for vocabulary variables"
```

---

## Task 14: Gate, end-to-end proof, docs, PR

**Files:**
- Modify: `src/i18n/vocabularyLint.test.ts` (BASELINE becomes an `ALLOW` map)
- Modify: `e2e/org-kind.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md` (R4 and Delivery)
- Modify: `CLAUDE.md` (i18n section, one bullet)

- [ ] **Step 1: Replace the ratchet with the allowlist.** In `src/i18n/vocabularyLint.test.ts` delete `BASELINE` and add:

```ts
// Strings that deliberately keep a bare noun. Every entry names its reason; anything
// else that mentions a domain noun must use a vocabulary variable.
const ALLOW: Record<string, string> = {
  "settingsHireOrders.numberingCard.description": "documents the {cast} and {cast|seq} numbering placeholders, machine tokens",
  "settingsAirtable.manageDialog.baseTable.tableNamePlaceholder": "example Airtable table name, a proper noun in the customer's base",
  // add each remaining hit from the report here, with its reason
};
```

and change the assertion to:

```ts
    const offenders = hits.filter((h) => !(h.path in ALLOW));
    expect(offenders.map((h) => `${h.path} (${h.count})`), "bare domain noun outside the allowlist").toEqual([]);
    const stale = Object.keys(ALLOW).filter((p) => !hits.some((h) => h.path === p));
    expect(stale, "allowlist entries that no longer match anything").toEqual([]);
```

Run: `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts`
Expected: PASS with only the allowlisted paths printed. If a non-allowlisted hit remains, fix the copy, do not extend the allowlist beyond the categories in English rule 8.

- [ ] **Step 2: Extend the e2e smoke** in `e2e/org-kind.spec.ts`. After the reload assertion inside the existing test, add:

```ts
    // The vocabulary follows the org: the sidebar now reads staffing nouns.
    await expect(page.getByRole("link", { name: /^people$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^shifts$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^artists$/i })).toHaveCount(0);
```

and a second test:

```ts
  test("switching back restores the production vocabulary", async ({ page }) => {
    await seedConsent(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /^organization\b/i }).click();
    await page.getByLabel(/workspace type/i).click();
    await page.getByRole("option", { name: /live production/i }).click();
    await expect(page.getByText(/workspace type updated/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^artists$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^dates$/i })).toBeVisible();
  });
```

(Check `src/components/layout/AppLayout.tsx` for the sidebar link role; if nav items are buttons, use `getByRole("button", ...)`. Confirm `common.nav.artists` is `{{Artists}}` and `common.nav.bookings` is `{{ShowDates}}` after Task 12.)

- [ ] **Step 3: Update the spec.** In R4 replace the `context: kind` sentence with: "otherwise add German-only per-kind sibling keys (`key_production` / `key_staffing`) and set the base key to `$t(ns:path.key_{{kind}})`, which i18next resolves through the `kind` vocabulary variable with no call-site changes (pinned by `kindVariants.test.ts`)". In Delivery, move "plus the email and PDF copy maps converted to variables" from PR 2 to PR 3 with the reason (file-mode mirrors cannot import the table). Add under Testing: `vocabularyDiff.test.ts` (production byte-identity report).

- [ ] **Step 4: Update `CLAUDE.md`.** In the i18n bullet list add one bullet:

> **Domain nouns are vocabulary variables.** Copy never says "artist" or "show"; it says `{{artist}}` / `{{Show}}` and the org's workspace type (`src/lib/orgKind.ts`) fills them in through i18next `defaultVariables` (`VocabularyBridge`) or `interpolateVocabulary` (Help, glossary, minis). `src/i18n/vocabularyLint.test.ts` fails CI on a bare noun. Runtime variables never reuse a vocabulary key name (`showTitle`, `castName`, `artistName`). A German sentence that needs an article uses `_production` / `_staffing` siblings and `$t(ns:path.key_{{kind}})` (see `kindVariants.test.ts`).

- [ ] **Step 5: Full verification**

Run: `npm run verify:fast`
Expected: green (lint at zero warnings, three typechecks, build, unit with coverage, Deno).

Run: `npm run local:up && npm run verify:full`
Expected: pgTAP and Playwright green, including `e2e/org-kind.spec.ts`. If the local edge runtime dies (exit 137 as in PR 1), re-run only `npx playwright test --config=e2e/playwright.config.ts e2e/org-kind.spec.ts` and say so in the PR.

- [ ] **Step 6: Commit and open the PR**

```bash
git add src/i18n/vocabularyLint.test.ts e2e/org-kind.spec.ts docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md CLAUDE.md
git commit -m "gate bare nouns with an allowlist, prove staffing nav end to end, update docs"
git push -u origin claude/org-kind-pr2-copy-audit
```

Write the PR body to a file (never a heredoc with apostrophes) and open it with `gh pr create --title "workspace type (org_kind): copy audit, vocabulary variables in every client string" --body-file <file>`. The body: what and why (PR 2 of 3, mechanism recap in two lines), the two spec deviations, the production diff summary from `VOCAB_DIFF=1` (count per language and the categories), the German sibling count, the "German help/mini strings still production-specific" list from Task 13 for the owner's review, the checklist (tests, help center: N/A, i18n: yes, changelog: N/A, ships with PR 3), and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer. Ask the owner to review the German diff in particular.

---

## Self-review

**Spec coverage.** R4 locale files: Tasks 7 to 12. R4 German grammar rule: rules section plus Task 2 (mechanism) with the documented deviation. R4 `TERMS` and `roleLabel` kind-aware: Task 5. R4 noun scanner as allowlist gate: Tasks 3 and 14. R4 "translation-completeness allowlist gains interpolation-only strings": the existing `IDENTICAL_OK` map in `translationCompleteness.test.ts` is extended in whichever batch creates an EN/DE pair that becomes identical (for example a bare `{{Artist}}` header); batches run that test in Step 4. Help and minis: Tasks 6 and 13. Email and PDF copy maps: explicitly moved to PR 3 (deviation 2). Spec's E2E: Task 14 Step 2.

**Placeholder scan.** No TBDs. Task 6 Step 1 defers one detail (the exact override argument name of `renderWithProviders`) to two named files in the repo; Task 14 Step 2 defers the nav element role to `AppLayout.tsx`. Both are lookups, not design.

**Type consistency.** `interpolateVocabulary(text, vocab)` (Task 1) is used with that signature in Task 6. `Vocabulary`/`VocabKey` come from `src/lib/orgKind.ts`. `useVocabulary()` returns `Vocabulary` (Task 6). `termLabel(key, lang, kind)` and `roleLabel(role, kind)` (Task 5) are the signatures Task 6 and PR 3 call. `englishSources`, `scanBareNouns`, `capitalisedTokens`, `VocabHit` (Task 3) are used by Tasks 4 and 14 as defined. The runtime variable names `showTitle`, `castName`, `artistName`, `artistCount`, `productionCount`, `skillNames`, `understudyCount` (Task 4) match the guard test. If the guard finds a further runtime variable named like a vocabulary key, rename it the same way (`<noun>Name(s)` or `<noun>Count`) and add it to the table.
